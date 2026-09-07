#!/usr/bin/env node

import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { drawioInstallHint, resolveDrawioExecutable } from "./drawio-path.mjs";

const SERVER_NAME = "drawio-live";
const SERVER_VERSION = "1.5.4";
const DRAWIO = resolveDrawioExecutable();
const DEFAULT_PORT = Number(process.env.DRAWIO_LIVE_PORT || 9333);
const PROFILE_ROOT = process.env.DRAWIO_LIVE_PROFILE || path.join(os.homedir(), ".drawio-live-mcp");
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const BASELINE_SHAPES = [
  "rectangle", "rounded", "ellipse", "diamond", "cylinder", "hexagon", "triangle", "parallelogram",
  "trapezoid", "pentagon", "star", "document", "note", "cloud", "text", "swimlane",
];
const BASELINE_SHAPE_SET = new Set(BASELINE_SHAPES);
const BASELINE_SHAPE_STYLES = {
  rectangle: "rounded=0;",
  rounded: "rounded=1;",
  ellipse: "ellipse;",
  diamond: "rhombus;",
  cylinder: "shape=cylinder3;boundedLbl=1;backgroundOutline=1;",
  hexagon: "shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;",
  triangle: "triangle;",
  parallelogram: "shape=parallelogram;perimeter=parallelogramPerimeter;",
  trapezoid: "shape=trapezoid;perimeter=trapezoidPerimeter;",
  pentagon: "shape=mxgraph.basic.pentagon;",
  star: "shape=mxgraph.basic.star;",
  document: "shape=document;boundedLbl=1;",
  note: "shape=note;size=15;",
  cloud: "ellipse;shape=cloud;",
  text: "text;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;html=1;fontColor=#1f2937;",
  swimlane: "swimlane;startSize=30;rounded=0;html=1;whiteSpace=wrap;fillColor=#f5f5f5;strokeColor=#666666;",
};

const live = {
  process: null,
  cdp: null,
  port: DEFAULT_PORT,
  target: null,
  stepDelayMs: 350,
};

const pointSchema = {
  type: "object",
  required: ["x", "y"],
  properties: { x: { type: "number" }, y: { type: "number" } },
  additionalProperties: false,
};

const shapeProperties = {
  id: { type: "string", description: "Stable cell id used by later edges/updates." },
  label: { type: "string", default: "" },
  shape: {
    type: "string",
    description: "Friendly built-in name or an exact registered draw.io shape/stencil name returned by drawio_live_get_capabilities. Unknown names are rejected instead of silently rendering as rectangles. A full style string may also be supplied.",
    default: "rounded",
  },
  x: { type: "number" },
  y: { type: "number" },
  width: { type: "number", exclusiveMinimum: 0 },
  height: { type: "number", exclusiveMinimum: 0 },
  style: { type: "string", description: "Full draw.io style override." },
  fill_color: { type: "string" },
  stroke_color: { type: "string" },
  font_color: { type: "string" },
  font_size: { type: "number", minimum: 1, maximum: 200 },
  stroke_width: { type: "number", minimum: 0, maximum: 50 },
};

const tools = [
  {
    name: "drawio_live_launch",
    description:
      "Launch or connect to a visible draw.io desktop window with a localhost-only debugging channel. Shapes added through the live tools appear immediately on screen. This does not pre-generate a diagram file.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Optional existing .drawio file to open visibly." },
        port: { type: "integer", minimum: 1024, maximum: 65535, default: 9333 },
        step_delay_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
        maximize: { type: "boolean", default: true },
        include_screenshot: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_status",
    description: "Report whether the visible draw.io editor and live graph are ready, including page title, viewport, zoom, and cell counts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "drawio_live_get_capabilities",
    description: "Read the available draw.io graph primitives, registered shapes, edge styles, markers, and the Scientific Illustrator MCP coverage. This never launches draw.io and never changes the canvas; when already connected it also inspects the live renderer registry.",
    inputSchema: {
      type: "object",
      properties: {
        include_registered_shapes: { type: "boolean", default: true },
        include_registered_markers: { type: "boolean", default: true },
        include_registered_edge_styles: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_screenshot",
    description: "Capture the current visible draw.io renderer so the model can decide the next drawing action and the user can review progress.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "drawio_live_clear",
    description: "Remove the current page's drawable cells in the visible editor to start a blank live drawing. The change is visible and undoable in draw.io.",
    inputSchema: {
      type: "object",
      properties: { confirm: { type: "boolean", description: "Must be true because this removes current page content." } },
      required: ["confirm"],
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_add_shape",
    description: "Add one editable, verified shape directly to the currently visible draw.io canvas. Unknown shape names are rejected so draw.io cannot silently substitute a rectangle. The shape appears immediately; no XML file is opened.",
    inputSchema: {
      type: "object",
      required: ["id", "x", "y", "width", "height"],
      properties: { ...shapeProperties, pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 } },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_add_image",
    description: "Insert one tightly scoped raster/SVG evidence region as an editable draw.io image cell. A specific audit reason is mandatory; never use this for a whole panel containing reconstructable text, boxes, arrows, tables, charts, labels, or legends.",
    inputSchema: {
      type: "object",
      required: ["id", "image_path", "x", "y", "width", "height", "raster_reason", "source_is_tightly_cropped", "atomic_raster_unit", "contains_reconstructable_content", "decomposition_note"],
      properties: {
        id: { type: "string" },
        image_path: { type: "string" },
        label: { type: "string", default: "" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        raster_reason: { type: "string", minLength: 8 },
        source_is_tightly_cropped: { type: "boolean" },
        atomic_raster_unit: { type: "boolean", const: true, description: "Must be true only when the image contains one irreducible raster field, not a grid, montage, panel, comparison, or stack." },
        contains_reconstructable_content: { type: "boolean", const: false, description: "Must be false. Rebuild text, borders, arrows, legends, axes, tables, and regular plots as editable cells." },
        decomposition_note: { type: "string", minLength: 8, description: "State what was separated and rebuilt as editable cells, or why this image cannot be split further." },
        crop_left_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_top_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_right_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_bottom_percent: { type: "number", minimum: 0, maximum: 99 },
        preserve_aspect: { type: "boolean", default: true },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_add_line",
    description: "Add an editable unattached draw.io straight line or explicit polyline for arrows, axes, ticks, separators, and annotations. The default disables automatic orthogonal rerouting and rounded bends so the rendered path follows the supplied endpoints/waypoints.",
    inputSchema: {
      type: "object",
      required: ["id", "begin_x", "begin_y", "end_x", "end_y"],
      properties: {
        id: { type: "string" },
        label: { type: "string", default: "" },
        begin_x: { type: "number" },
        begin_y: { type: "number" },
        end_x: { type: "number" },
        end_y: { type: "number" },
        color: { type: "string" },
        width: { type: "number", minimum: 0, maximum: 50 },
        dashed: { type: "boolean" },
        curved: { type: "boolean" },
        start_arrow: { type: "string", default: "none" },
        end_arrow: { type: "string", default: "none" },
        start_clearance: { type: "number", minimum: 0, default: 0, description: "Trim this many canvas units from the beginning of the routed polyline." },
        end_clearance: { type: "number", minimum: 0, default: 0, description: "Trim this many canvas units from the end so the arrowhead does not intrude into a target object." },
        waypoints: { type: "array", maxItems: 100, items: pointSchema },
        style: { type: "string" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_add_edge",
    description: "Add one editable connector directly between two visible draw.io cells. The edge appears immediately.",
    inputSchema: {
      type: "object",
      required: ["id", "source", "target"],
      properties: {
        id: { type: "string" },
        source: { type: "string" },
        target: { type: "string" },
        label: { type: "string", default: "" },
        style: { type: "string" },
        color: { type: "string" },
        width: { type: "number", minimum: 0, maximum: 50 },
        dashed: { type: "boolean" },
        curved: { type: "boolean" },
        start_arrow: { type: "string" },
        end_arrow: { type: "string" },
        exit_x: { type: "number", minimum: 0, maximum: 1 },
        exit_y: { type: "number", minimum: 0, maximum: 1 },
        entry_x: { type: "number", minimum: 0, maximum: 1 },
        entry_y: { type: "number", minimum: 0, maximum: 1 },
        waypoints: { type: "array", maxItems: 100, items: pointSchema },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_add_table",
    description: "Add an editable composite draw.io table made from individually editable text/rectangle cells, with stable cell ids, header styling, banding, and borders.",
    inputSchema: {
      type: "object",
      required: ["id", "rows", "columns", "x", "y", "width", "height"],
      properties: {
        id: { type: "string" },
        rows: { type: "integer", minimum: 1, maximum: 200 },
        columns: { type: "integer", minimum: 1, maximum: 100 },
        data: { type: "array", maxItems: 200, items: { type: "array", maxItems: 100, items: { type: ["string", "number", "boolean", "null"] } } },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        header_rows: { type: "integer", minimum: 0, maximum: 20, default: 1 },
        fill_color: { type: "string", default: "#FFFFFF" },
        header_fill_color: { type: "string", default: "#D9EAF7" },
        header_font_color: { type: "string", default: "#1F2937" },
        header_bold: { type: "boolean", default: true },
        banded_rows: { type: "boolean", default: false },
        band_fill_color: { type: "string", default: "#F7FAFC" },
        stroke_color: { type: "string", default: "#6B7280" },
        stroke_width: { type: "number", minimum: 0, maximum: 20, default: 1 },
        font_color: { type: "string", default: "#1F2937" },
        font_size: { type: "number", minimum: 1, maximum: 200, default: 12 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_update_table_cell",
    description: "Update one editable cell in a composite draw.io table by table id, row, and column.",
    inputSchema: {
      type: "object",
      required: ["table_id", "row", "column"],
      properties: {
        table_id: { type: "string" },
        row: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
        label: { type: "string" },
        style: { type: "string" },
        fill_color: { type: "string" },
        stroke_color: { type: "string" },
        font_color: { type: "string" },
        font_size: { type: "number", minimum: 1, maximum: 200 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_update_table_layout",
    description: "Set exact column widths and row heights for an editable composite draw.io table, preserving individual editable cells and semantic ids.",
    inputSchema: {
      type: "object",
      required: ["table_id"],
      properties: {
        table_id: { type: "string" },
        column_widths: { type: "array", minItems: 1, maxItems: 100, items: { type: "number", exclusiveMinimum: 0 } },
        row_heights: { type: "array", minItems: 1, maxItems: 200, items: { type: "number", exclusiveMinimum: 0 } },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_add_chart",
    description: "Add a regular quantitative chart as a fully editable draw.io composite of text, rectangles, markers, grid lines, and connectors. Prefer this or deliberate primitives over a chart screenshot.",
    inputSchema: {
      type: "object",
      required: ["id", "chart_type", "categories", "series", "x", "y", "width", "height"],
      properties: {
        id: { type: "string" },
        chart_type: { type: "string", enum: ["column_clustered", "bar_clustered", "line", "scatter"] },
        categories: { type: "array", minItems: 1, maxItems: 1000, items: { type: ["string", "number"] } },
        series: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["name", "values"], properties: { name: { type: "string" }, values: { type: "array", minItems: 1, maxItems: 1000, items: { type: "number" } } }, additionalProperties: false } },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        title: { type: "string" },
        category_axis_title: { type: "string" },
        value_axis_title: { type: "string" },
        show_legend: { type: "boolean", default: true },
        palette: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_update_cell",
    description: "Change one existing visible cell's label, full style, position, or size in place. The edit appears immediately and participates in draw.io undo.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        label: { type: "string" },
        style: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_duplicate_cell",
    description: "Duplicate an editable draw.io cell or composite group, including children, and assign a stable new id.",
    inputSchema: {
      type: "object",
      required: ["id", "new_id"],
      properties: {
        id: { type: "string" },
        new_id: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_group_cells",
    description: "Group two or more editable draw.io cells under a stable semantic group id.",
    inputSchema: {
      type: "object",
      required: ["id", "cell_ids"],
      properties: {
        id: { type: "string" },
        cell_ids: { type: "array", minItems: 2, maxItems: 500, uniqueItems: true, items: { type: "string" } },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_ungroup_cell",
    description: "Ungroup one editable draw.io group and return its member ids.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" }, pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 } },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_set_z_order",
    description: "Move an editable draw.io cell forward, backward, to the front, or to the back.",
    inputSchema: {
      type: "object",
      required: ["id", "command"],
      properties: {
        id: { type: "string" },
        command: { type: "string", enum: ["bring_to_front", "send_to_back", "bring_forward", "send_backward"] },
        repeat: { type: "integer", minimum: 1, maximum: 1000, default: 1 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_align_cells",
    description: "Align two or more editable cells to an exact shared edge or center. Selection alignment preserves the outer selection bounds; page alignment uses the current draw.io page.",
    inputSchema: {
      type: "object",
      required: ["cell_ids", "alignment"],
      properties: {
        cell_ids: { type: "array", minItems: 2, maxItems: 500, uniqueItems: true, items: { type: "string", minLength: 1 } },
        alignment: { type: "string", enum: ["left", "center", "right", "top", "middle", "bottom"] },
        relative_to: { type: "string", enum: ["selection", "page"], default: "selection" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_distribute_cells",
    description: "Distribute three or more editable cells with equal horizontal or vertical gaps, relative to the selection bounds or current page.",
    inputSchema: {
      type: "object",
      required: ["cell_ids", "direction"],
      properties: {
        cell_ids: { type: "array", minItems: 3, maxItems: 500, uniqueItems: true, items: { type: "string", minLength: 1 } },
        direction: { type: "string", enum: ["horizontal", "vertical"] },
        relative_to: { type: "string", enum: ["selection", "page"], default: "selection" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_audit_figure",
    description: "Run a read-only deterministic geometry, connector, text-fit, repeated-layout, and raster editability audit on the visible draw.io model. Returns named hard failures and correction-oriented findings.",
    inputSchema: {
      type: "object",
      properties: {
        alignment_tolerance: { type: "number", minimum: 0.05, maximum: 100, default: 1 },
        endpoint_clearance: { type: "number", minimum: 0, maximum: 100, default: 2 },
        text_overflow_tolerance: { type: "number", minimum: 0, maximum: 100, default: 2 },
        large_raster_area_ratio: { type: "number", minimum: 0.001, maximum: 1, default: 0.08 },
        max_findings: { type: "integer", minimum: 1, maximum: 2000, default: 300 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_draw_sequence",
    description:
      "Execute a paced sequence of shape, edge, update, fit, and wait operations in the visible draw.io editor. Each operation is applied separately with a delay so the user can watch the drawing process.",
    inputSchema: {
      type: "object",
      required: ["operations"],
      properties: {
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 500,
        items: { type: "object", description: "An operation with type: shape, image, line, edge, table, table_cell, table_layout, chart, duplicate, group, ungroup, z_order, align, distribute, update, fit, or wait." },
        },
        step_delay_ms: { type: "integer", minimum: 0, maximum: 10000 },
        screenshot_after: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_fit",
    description: "Fit the current live diagram into the visible draw.io window or set a specific zoom percentage.",
    inputSchema: {
      type: "object",
      properties: { zoom_percent: { type: "number", minimum: 10, maximum: 800 } },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_inspect",
    description: "Read a compact inventory of cells from the currently visible draw.io model for subsequent live edits.",
    inputSchema: {
      type: "object",
      properties: { max_cells: { type: "integer", minimum: 1, maximum: 2000, default: 500 } },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_save_snapshot",
    description:
      "Save the current already-visible live draw.io model to an uncompressed .drawio file. This serializes the canvas after live drawing; it does not construct XML first and then open it.",
    inputSchema: {
      type: "object",
      required: ["output_path"],
      properties: {
        output_path: { type: "string" },
        page_name: { type: "string", default: "Live drawing" },
        overwrite: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_reload_from_disk",
    description:
      "After an agent rewrites the already-open .drawio file on disk, wait for draw.io Desktop's red file-changed banner and trigger its synchronize handler so the visible viewport reloads without restarting the app. Uses the in-page menubar status click listener (no OS mouse). data-action=statusFunction is only a marker; this does not call a public window.statusFunction API. Prefer this over close/relaunch for ordinary disk→viewport refresh.",
    inputSchema: {
      type: "object",
      properties: {
        wait_ms: {
          type: "integer",
          minimum: 0,
          maximum: 60000,
          default: 5000,
          description: "How long to wait for the red geStatusAlert banner after the disk write.",
        },
        include_screenshot: {
          type: "boolean",
          default: false,
          description: "When true, return a viewport screenshot after a successful reload.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drawio_live_close_session",
    description: "Close only the draw.io process launched by this MCP server. Refuses to close an externally connected user session and requires confirm=true.",
    inputSchema: {
      type: "object",
      required: ["confirm"],
      properties: { confirm: { const: true } },
      additionalProperties: false,
    },
  },
];

class CdpClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to draw.io debugging channel.")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Failed to connect to draw.io debugging channel.")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    this.ws.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("draw.io debugging channel closed."));
      this.pending.clear();
    });
  }

  call(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("draw.io live session is not connected.");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP method timed out: ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function ensureStyle(style = "") {
  return style && !style.endsWith(";") ? `${style};` : style;
}

function setStyle(style, key, value) {
  if (value === undefined || value === null) return style;
  const entries = ensureStyle(style).split(";").filter(Boolean);
  const filtered = entries.filter((entry) => entry.split("=", 1)[0] !== key);
  filtered.push(`${key}=${value}`);
  return `${filtered.join(";")};`;
}

function shapeStyle(shape = "rounded") {
  const common = "whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#1f2937;";
  if (BASELINE_SHAPE_STYLES[shape]) {
    const baseline = BASELINE_SHAPE_STYLES[shape];
    return shape === "text" || shape === "swimlane" ? baseline : `${baseline}${common}`;
  }
  return `shape=${shape};${common}`;
}

function edgeStyle(args, defaultStyle = "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;") {
  let style = args.style || defaultStyle;
  style = setStyle(style, "strokeColor", args.color);
  style = setStyle(style, "strokeWidth", args.width);
  if (args.dashed !== undefined) style = setStyle(style, "dashed", args.dashed ? 1 : 0);
  if (args.curved !== undefined) style = setStyle(style, "curved", args.curved ? 1 : 0);
  style = setStyle(style, "startArrow", args.start_arrow);
  style = setStyle(style, "endArrow", args.end_arrow);
  style = setStyle(style, "exitX", args.exit_x);
  style = setStyle(style, "exitY", args.exit_y);
  style = setStyle(style, "entryX", args.entry_x);
  style = setStyle(style, "entryY", args.entry_y);
  return ensureStyle(style);
}

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function toolResult(value, { imageData, isError = false } = {}) {
  const content = [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
  if (imageData) content.push({ type: "image", data: imageData, mimeType: "image/png" });
  return {
    content,
    ...(typeof value === "object" && value !== null ? { structuredContent: value } : {}),
    isError,
  };
}

async function jsonEndpoint(port, endpoint) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`Debug endpoint returned ${response.status}.`);
  return response.json();
}

async function findTarget(port) {
  const targets = await jsonEndpoint(port, "/json/list");
  const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  return pages.find((target) => /draw\.io|diagrams\.net/i.test(`${target.title} ${target.url}`)) || null;
}

async function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)));
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < Math.min(65535, startPort + 100); port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free localhost port found near ${startPort}.`);
}

async function waitForTarget(port, timeoutMs = 25000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const target = await findTarget(port);
      if (target) return target;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`draw.io opened but no debuggable editor page appeared.${lastError ? ` ${lastError.message}` : ""}`);
}

async function connectTarget(target) {
  if (live.cdp?.ws?.readyState === WebSocket.OPEN && live.target?.id === target.id) return;
  try { live.cdp?.ws?.close(); } catch {}
  live.cdp = new CdpClient(target.webSocketDebuggerUrl);
  await live.cdp.connect();
  live.target = target;
  await live.cdp.call("Runtime.enable");
  await live.cdp.call("Page.enable");
  await live.cdp.call("Page.bringToFront").catch(() => {});
  await sleep(300);
  await recoverGraphReference().catch(() => false);
}

async function ensureConnected() {
  if (live.cdp?.ws?.readyState === WebSocket.OPEN) return;
  const target = await waitForTarget(live.port, 5000);
  await connectTarget(target);
}

async function evaluate(expression, { awaitPromise = true } = {}) {
  await ensureConnected();
  const result = await live.cdp.call("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "draw.io evaluation failed.";
    throw new Error(description);
  }
  return result.result?.value;
}

async function getRemoteProperties(objectId, ownProperties = true) {
  const result = await live.cdp.call("Runtime.getProperties", {
    objectId,
    ownProperties,
    accessorPropertiesOnly: false,
    generatePreview: true,
  });
  return result;
}

async function bindRemoteGraph(objectId) {
  const result = await live.cdp.call("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: "function(){ window.__codexDrawioGraph = this; return !!(this && this.getModel && this.insertVertex); }",
    returnByValue: true,
    userGesture: true,
  });
  return result.result?.value === true;
}

async function recoverGraphReference() {
  const existing = await live.cdp.call("Runtime.evaluate", {
    expression: "!!(window.__codexDrawioGraph && window.__codexDrawioGraph.getModel && window.__codexDrawioGraph.insertVertex)",
    returnByValue: true,
  });
  if (existing.result?.value === true) return true;

  const listeners = await live.cdp.call("Runtime.evaluate", {
    expression: "document.querySelector('.geDiagramContainer')?.mxListenerList?.map((item) => item.f).filter(Boolean) || []",
    returnByValue: false,
  });
  const listId = listeners.result?.objectId;
  if (!listId) return false;
  const listProps = await getRemoteProperties(listId, true);
  const functions = listProps.result.filter((prop) => /^\d+$/.test(prop.name) && prop.value?.objectId).slice(0, 40);

  for (const fnProp of functions) {
    const fnProps = await getRemoteProperties(fnProp.value.objectId, false);
    const scopesId = fnProps.internalProperties?.find((prop) => prop.name === "[[Scopes]]")?.value?.objectId;
    if (!scopesId) continue;
    const scopeList = await getRemoteProperties(scopesId, true);
    for (const scopeProp of scopeList.result.filter((prop) => /^\d+$/.test(prop.name) && prop.value?.objectId && /Closure/i.test(prop.value.description || ""))) {
      const scope = await getRemoteProperties(scopeProp.value.objectId, true);
      for (const variable of scope.result) {
        const remote = variable.value;
        if (!remote?.objectId || remote.type !== "object") continue;
        if (remote.className === "Graph" && await bindRemoteGraph(remote.objectId)) return true;
        if (!/^(?:mxCellEditor|EditorUi|Editor|Graph|Object)$/.test(remote.className || "") && variable.name !== "a") continue;
        const objectProps = await getRemoteProperties(remote.objectId, true).catch(() => null);
        const graphProp = objectProps?.result?.find((prop) => prop.name === "graph" && prop.value?.objectId && prop.value.className === "Graph");
        if (graphProp && await bindRemoteGraph(graphProp.value.objectId)) return true;
      }
    }
  }
  return false;
}

const graphLookup = `
  const __findUi = () => {
    for (const key of ['ui', 'editorUi', 'app']) {
      try { if (window[key] && window[key].editor && window[key].editor.graph) return window[key]; } catch {}
    }
    for (const key of Object.keys(window)) {
      try {
        const value = window[key];
        if (value && typeof value === 'object' && value.editor && value.editor.graph && value.editor.graph.getModel) return value;
      } catch {}
    }
    return null;
  };
  const ui = __findUi();
  const graph = window.__codexDrawioGraph || (ui && ui.editor && ui.editor.graph);
  if (!graph) throw new Error('The draw.io editor graph is not ready. Ensure a blank or existing diagram is open in draw.io.');
`;

async function graphEval(body) {
  const expression = `(() => { ${graphLookup} ${body} })()`;
  try { new Function(`return ${expression};`); }
  catch (error) { throw new Error(`Internal draw.io graph expression is invalid: ${error.message}`); }
  await ensureConnected();
  await recoverGraphReference();
  return evaluate(expression);
}

async function liveStatus() {
  await ensureConnected();
  await recoverGraphReference().catch(() => false);
  return evaluate(`(() => {
    const foundUi = (() => {
      for (const key of ['ui', 'editorUi', 'app']) { try { if (window[key]?.editor?.graph) return window[key]; } catch {} }
      for (const key of Object.keys(window)) { try { if (window[key]?.editor?.graph?.getModel) return window[key]; } catch {} }
      return null;
    })();
    const graph = window.__codexDrawioGraph || foundUi?.editor?.graph;
    const base = { title: document.title, url: location.href, viewport: { width: innerWidth, height: innerHeight }, graph_ready: !!graph, control_scope: 'draw.io graph API only' };
    if (!graph) return base;
    const parent = graph.getDefaultParent();
    return { ...base, zoom_percent: Math.round(graph.view.scale * 100), vertices: graph.getChildVertices(parent).length, edges: graph.getChildEdges(parent).length };
  })()`);
}

async function captureScreenshot() {
  await ensureConnected();
  const { data } = await live.cdp.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  return data;
}

async function getCapabilities(args = {}) {
  const connected = live.cdp?.ws?.readyState === WebSocket.OPEN;
  let registry = { shapes: [], stencils: [], markers: [], edge_styles: [], perimeters: [] };
  if (connected) {
    try {
      registry = await evaluate(`(() => ({
        shapes: typeof mxCellRenderer !== 'undefined' ? Object.keys(mxCellRenderer.defaultShapes || {}).sort() : [],
        stencils: typeof mxStencilRegistry !== 'undefined' ? Object.keys(mxStencilRegistry.stencils || {}).sort() : [],
        markers: typeof mxMarker !== 'undefined' ? Object.keys(mxMarker.markers || {}).sort() : [],
        edge_styles: typeof mxStyleRegistry !== 'undefined' ? Object.keys(mxStyleRegistry.values || {}).filter((key) => /edge/i.test(key)).sort() : [],
        perimeters: typeof mxStyleRegistry !== 'undefined' ? Object.keys(mxStyleRegistry.values || {}).filter((key) => /perimeter/i.test(key)).sort() : [],
      }))()`);
    } catch {}
  }
  const nativeObjectFamilies = [
    { family: "text_box", implementation: "editable text vertex", mcp_tool: "drawio_live_add_shape", mcp_available: true, preferred_for: ["titles", "labels", "captions", "paragraphs"] },
    { family: "auto_shape", implementation: "editable mxGraph vertex", mcp_tool: "drawio_live_add_shape", mcp_available: true, preferred_for: ["boxes", "symbols", "flowchart nodes", "panel containers"] },
    { family: "free_line_or_arrow", implementation: "editable edge with terminal points", mcp_tool: "drawio_live_add_line", mcp_available: true, preferred_for: ["axes", "ticks", "separators", "free arrows"] },
    { family: "attached_connector", implementation: "editable edge attached to source and target cells", mcp_tool: "drawio_live_add_edge", mcp_available: true, preferred_for: ["semantic links that stay attached"] },
    { family: "table", implementation: "editable composite group of rectangle/text cells", mcp_tool: "drawio_live_add_table", layout_tool: "drawio_live_update_table_layout", mcp_available: true, preferred_for: ["tables", "matrix layouts", "grid annotations"] },
    { family: "chart", implementation: "editable composite of axes, text, bars, markers, and edges", mcp_tool: "drawio_live_add_chart", mcp_available: true, supported_chart_types: ["column_clustered", "bar_clustered", "line", "scatter"] },
    { family: "picture_or_svg", implementation: "editable image vertex with serialized raster audit metadata", mcp_tool: "drawio_live_add_image", mcp_available: true, preferred_for: ["tightly cropped microscopy", "photographic texture", "heatmaps", "irreducible raster evidence"], restriction: "Never use for a whole panel containing reconstructable text, shapes, arrows, tables, charts, or legends." },
    { family: "duplicate", implementation: "deep mxGraph cell clone", mcp_tool: "drawio_live_duplicate_cell", mcp_available: true },
    { family: "group", implementation: "editable mxGraph group", mcp_tool: "drawio_live_group_cells", mcp_available: true },
    { family: "ungroup", implementation: "mxGraph ungroup", mcp_tool: "drawio_live_ungroup_cell", mcp_available: true },
    { family: "z_order", implementation: "parent child-order mutation", mcp_tool: "drawio_live_set_z_order", mcp_available: true },
    { family: "align", implementation: "exact model-coordinate alignment", mcp_tool: "drawio_live_align_cells", mcp_available: true },
    { family: "distribute", implementation: "equal-gap model-coordinate distribution", mcp_tool: "drawio_live_distribute_cells", mcp_available: true },
    { family: "figure_audit", implementation: "read-only renderer and graph-model audit", mcp_tool: "drawio_live_audit_figure", mcp_available: true },
  ];
  return {
    detection: {
      read_only: true,
      launched_drawio: false,
      active_canvas_modified: false,
      basis: connected ? ["Scientific Illustrator tool catalog", "live draw.io renderer registry"] : ["Scientific Illustrator tool catalog"],
    },
    host: { platform: process.platform, executable: DRAWIO.executable, executable_source: DRAWIO.source, connected, graph_ready: connected ? Boolean((await liveStatus()).graph_ready) : false },
    native_object_families: nativeObjectFamilies,
    baseline_shapes: BASELINE_SHAPES.map((plugin_name) => ({ plugin_name, mcp_available: true })),
    ...(args.include_registered_shapes === false ? {} : { registered_shapes: registry.shapes }),
    ...(args.include_registered_shapes === false ? {} : { registered_stencils: registry.stencils }),
    ...(args.include_registered_markers === false ? {} : { registered_markers: registry.markers }),
    ...(args.include_registered_edge_styles === false ? {} : { registered_edge_styles: registry.edge_styles, registered_perimeters: registry.perimeters }),
    mcp_coverage: {
      server_version: SERVER_VERSION,
      tool_count: tools.length,
      tools: tools.map((tool) => tool.name).sort(),
      native_first_policy: "Use editable graph cells or editable composites for every reconstructable semantic object. Every image must be one atomic irreducible raster unit with a decomposition note and must pass drawio_live_audit_figure.",
    },
  };
}

function mimeTypeForImage(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  const mimeType = mimeTypes[extension];
  if (!mimeType) throw new Error(`Unsupported image type '${extension}'. Use PNG, JPG, GIF, WebP, or SVG.`);
  return mimeType;
}

async function addImage(args) {
  const imagePath = path.resolve(args.image_path);
  const reason = String(args.raster_reason || "").trim();
  if (reason.length < 8) throw new Error("raster_reason must specifically explain why this exact region cannot be recreated with editable draw.io primitives.");
  if (args.atomic_raster_unit !== true) {
    throw new Error("atomic_raster_unit=true is required. Split grids, comparisons, montages, stacks, panels, and other multi-part visuals into separate image cells first.");
  }
  if (args.contains_reconstructable_content !== false) {
    throw new Error("contains_reconstructable_content must be false. Rebuild text, borders, arrows, legends, axes, tables, and regular plots as editable draw.io cells.");
  }
  const decompositionNote = String(args.decomposition_note || "").trim();
  if (decompositionNote.length < 8) {
    throw new Error("decomposition_note must state what was separated and rebuilt as editable cells, or why this image cannot be split further.");
  }
  const crop = {
    left: Number(args.crop_left_percent || 0),
    top: Number(args.crop_top_percent || 0),
    right: Number(args.crop_right_percent || 0),
    bottom: Number(args.crop_bottom_percent || 0),
  };
  const hasCrop = Object.values(crop).some((value) => value > 0);
  if (!args.source_is_tightly_cropped && !hasCrop) {
    throw new Error("source_is_tightly_cropped=false requires crop percentages. Crop away all surrounding reconstructable content before insertion.");
  }
  if (crop.left + crop.right >= 100 || crop.top + crop.bottom >= 100) throw new Error("Opposing crop percentages must total less than 100%.");
  const mimeType = mimeTypeForImage(imagePath);
  const source = await fs.readFile(imagePath);
  let imageDataUrl = `data:${mimeType};base64,${source.toString("base64")}`;
  if (hasCrop) {
    const visibleWidth = 100 - crop.left - crop.right;
    const visibleHeight = 100 - crop.top - crop.bottom;
    const wrapperWidth = 1000;
    const wrapperHeight = 1000;
    const imageX = -(crop.left / visibleWidth) * wrapperWidth;
    const imageY = -(crop.top / visibleHeight) * wrapperHeight;
    const imageWidth = (100 / visibleWidth) * wrapperWidth;
    const imageHeight = (100 / visibleHeight) * wrapperHeight;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wrapperWidth}" height="${wrapperHeight}" viewBox="0 0 ${wrapperWidth} ${wrapperHeight}"><image href="${imageDataUrl}" x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none"/></svg>`;
    imageDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  }
  const style = ensureStyle(`shape=image;html=1;imageAspect=${args.preserve_aspect === false ? 0 : 1};aspect=${args.preserve_aspect === false ? "" : "fixed"};image=${imageDataUrl};verticalLabelPosition=bottom;verticalAlign=top;`);
  const payload = JSON.stringify({ ...args, image_path: imagePath, style });
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    if (model.getCell(a.id)) throw new Error('Cell id already exists: ' + a.id);
    const doc = mxUtils.createXmlDocument();
    const metadata = doc.createElement('object');
    metadata.setAttribute('label', a.label || '');
    metadata.setAttribute('scientificIllustratorRasterReason', a.raster_reason);
    metadata.setAttribute('scientificIllustratorSourceTightlyCropped', String(!!a.source_is_tightly_cropped));
    metadata.setAttribute('scientificIllustratorAtomicRasterUnit', String(a.atomic_raster_unit === true));
    metadata.setAttribute('scientificIllustratorContainsReconstructableContent', String(a.contains_reconstructable_content === true));
    metadata.setAttribute('scientificIllustratorDecompositionNote', a.decomposition_note);
    metadata.setAttribute('scientificIllustratorSourcePath', a.image_path);
    metadata.setAttribute('scientificIllustratorCropLeftPercent', String(Number(a.crop_left_percent || 0)));
    metadata.setAttribute('scientificIllustratorCropTopPercent', String(Number(a.crop_top_percent || 0)));
    metadata.setAttribute('scientificIllustratorCropRightPercent', String(Number(a.crop_right_percent || 0)));
    metadata.setAttribute('scientificIllustratorCropBottomPercent', String(Number(a.crop_bottom_percent || 0)));
    const parent = graph.getDefaultParent();
    let cell;
    model.beginUpdate();
    try { cell = graph.insertVertex(parent, a.id, metadata, Number(a.x), Number(a.y), Number(a.width), Number(a.height), a.style); }
    finally { model.endUpdate(); }
    graph.setSelectionCell(cell);
    graph.scrollCellToVisible(cell);
    return {
      id: cell.id,
      type: 'image',
      geometry: cell.geometry,
      style: cell.style,
      raster_reason: a.raster_reason,
      source_is_tightly_cropped: !!a.source_is_tightly_cropped,
      atomic_raster_unit: a.atomic_raster_unit === true,
      contains_reconstructable_content: a.contains_reconstructable_content === true,
      decomposition_note: a.decomposition_note,
      crop_percent: {
        left: Number(a.crop_left_percent || 0),
        top: Number(a.crop_top_percent || 0),
        right: Number(a.crop_right_percent || 0),
        bottom: Number(a.crop_bottom_percent || 0),
      },
    };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

function trimPolylineEndpoints(args) {
  const points = [
    { x: Number(args.begin_x), y: Number(args.begin_y) },
    ...(args.waypoints || []).map((point) => ({ x: Number(point.x), y: Number(point.y) })),
    { x: Number(args.end_x), y: Number(args.end_y) },
  ];
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error("Line coordinates must be finite numbers.");
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    cumulative.push(cumulative[index - 1] + length);
  }
  const total = cumulative.at(-1);
  if (total <= 1e-6) throw new Error("Line length must be greater than zero.");
  const startClearance = Number(args.start_clearance || 0);
  const endClearance = Number(args.end_clearance || 0);
  if (!Number.isFinite(startClearance) || !Number.isFinite(endClearance) || startClearance < 0 || endClearance < 0) {
    throw new Error("start_clearance and end_clearance must be finite non-negative numbers.");
  }
  if (startClearance + endClearance >= total) throw new Error("start_clearance + end_clearance must be less than the routed line length.");
  const pointAt = (distance) => {
    if (distance <= 0) return { ...points[0] };
    if (distance >= total) return { ...points.at(-1) };
    for (let index = 1; index < points.length; index += 1) {
      if (distance > cumulative[index]) continue;
      const segmentLength = cumulative[index] - cumulative[index - 1];
      if (segmentLength <= 1e-9) continue;
      const ratio = (distance - cumulative[index - 1]) / segmentLength;
      return {
        x: points[index - 1].x + (points[index].x - points[index - 1].x) * ratio,
        y: points[index - 1].y + (points[index].y - points[index - 1].y) * ratio,
      };
    }
    return { ...points.at(-1) };
  };
  const startDistance = startClearance;
  const endDistance = total - endClearance;
  const waypoints = points.slice(1, -1).filter((_, index) => {
    const distance = cumulative[index + 1];
    return distance > startDistance + 1e-6 && distance < endDistance - 1e-6;
  });
  return {
    begin: pointAt(startDistance),
    end: pointAt(endDistance),
    waypoints,
    startClearance,
    endClearance,
    routedLength: total,
  };
}

async function addLine(args) {
  const trimmed = trimPolylineEndpoints(args);
  const style = edgeStyle(
    { ...args, start_arrow: args.start_arrow || "none", end_arrow: args.end_arrow || "none" },
    "edgeStyle=none;rounded=0;html=1;endArrow=none;startArrow=none;",
  );
  const payload = JSON.stringify({
    ...args,
    requested_begin_x: Number(args.begin_x),
    requested_begin_y: Number(args.begin_y),
    requested_end_x: Number(args.end_x),
    requested_end_y: Number(args.end_y),
    begin_x: trimmed.begin.x,
    begin_y: trimmed.begin.y,
    end_x: trimmed.end.x,
    end_y: trimmed.end.y,
    waypoints: trimmed.waypoints,
    start_clearance: trimmed.startClearance,
    end_clearance: trimmed.endClearance,
    routed_length: trimmed.routedLength,
    style,
  });
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    if (model.getCell(a.id)) throw new Error('Cell id already exists: ' + a.id);
    const parent = graph.getDefaultParent();
    const doc = mxUtils.createXmlDocument();
    const metadata = doc.createElement('object');
    metadata.setAttribute('label', a.label || '');
    metadata.setAttribute('scientificIllustratorType', 'line');
    metadata.setAttribute('scientificIllustratorRequestedBeginX', String(a.requested_begin_x));
    metadata.setAttribute('scientificIllustratorRequestedBeginY', String(a.requested_begin_y));
    metadata.setAttribute('scientificIllustratorRequestedEndX', String(a.requested_end_x));
    metadata.setAttribute('scientificIllustratorRequestedEndY', String(a.requested_end_y));
    metadata.setAttribute('scientificIllustratorStartClearance', String(a.start_clearance));
    metadata.setAttribute('scientificIllustratorEndClearance', String(a.end_clearance));
    let edge;
    model.beginUpdate();
    try {
      edge = graph.insertEdge(parent, a.id, metadata, null, null, a.style);
      const geo = edge.getGeometry().clone();
      geo.setTerminalPoint(new mxPoint(Number(a.begin_x), Number(a.begin_y)), true);
      geo.setTerminalPoint(new mxPoint(Number(a.end_x), Number(a.end_y)), false);
      if (a.waypoints && a.waypoints.length) geo.points = a.waypoints.map((p) => new mxPoint(Number(p.x), Number(p.y)));
      model.setGeometry(edge, geo);
    } finally { model.endUpdate(); }
    graph.setSelectionCell(edge);
    graph.scrollCellToVisible(edge);
    return {
      id: edge.id,
      type: 'line',
      label: graph.convertValueToString(edge),
      geometry: edge.geometry,
      style: edge.style,
      requested_begin: { x: a.requested_begin_x, y: a.requested_begin_y },
      requested_end: { x: a.requested_end_x, y: a.requested_end_y },
      actual_begin: { x: a.begin_x, y: a.begin_y },
      actual_end: { x: a.end_x, y: a.end_y },
      start_clearance: a.start_clearance,
      end_clearance: a.end_clearance,
      routed_length: a.routed_length,
    };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function addShape(args) {
  const requestedShape = String(args.shape || "rounded").trim();
  if (!requestedShape) throw new Error("shape must not be empty.");
  const explicitStyleOverride = typeof args.style === "string" && args.style.trim().length > 0;
  const shapeContainsFullStyle = !explicitStyleOverride && /[;=]/.test(requestedShape);
  if (!explicitStyleOverride && !shapeContainsFullStyle && !BASELINE_SHAPE_SET.has(requestedShape)) {
    const registration = await graphEval(`
      const requestedShape = ${JSON.stringify(requestedShape)};
      const rendererRegistered = typeof mxCellRenderer !== 'undefined' && Object.prototype.hasOwnProperty.call(mxCellRenderer.defaultShapes || {}, requestedShape);
      const stencilRegistered = typeof mxStencilRegistry !== 'undefined' && (
        Object.prototype.hasOwnProperty.call(mxStencilRegistry.stencils || {}, requestedShape) ||
        (typeof mxStencilRegistry.getStencil === 'function' && !!mxStencilRegistry.getStencil(requestedShape))
      );
      return { renderer_registered: rendererRegistered, stencil_registered: stencilRegistered };
    `);
    if (!registration.renderer_registered && !registration.stencil_registered) {
      throw new Error(`Unknown or unloaded draw.io shape "${requestedShape}". Scientific Illustrator refused draw.io's silent rectangle fallback. Use a baseline or registered name from drawio_live_get_capabilities, reconstruct the object from editable primitives, supply an intentional full style, or insert only the smallest irreducible raster region with drawio_live_add_image.`);
    }
  }
  let style = explicitStyleOverride ? args.style : shapeContainsFullStyle ? requestedShape : shapeStyle(requestedShape);
  style = setStyle(style, "fillColor", args.fill_color);
  style = setStyle(style, "strokeColor", args.stroke_color);
  style = setStyle(style, "fontColor", args.font_color);
  style = setStyle(style, "fontSize", args.font_size);
  style = setStyle(style, "strokeWidth", args.stroke_width);
  style = ensureStyle(style);
  const renderability = await graphEval(`
    const requestedStyle = ${JSON.stringify(style)};
    const probe = new mxCell('', new mxGeometry(0, 0, 1, 1), requestedStyle);
    probe.setVertex(true);
    const resolvedStyle = graph.getCellStyle(probe) || {};
    const resolvedShape = String(resolvedStyle[mxConstants.STYLE_SHAPE] || 'rectangle');
    const rendererRegistered = typeof mxCellRenderer !== 'undefined' && Object.prototype.hasOwnProperty.call(mxCellRenderer.defaultShapes || {}, resolvedShape);
    const stencilRegistered = typeof mxStencilRegistry !== 'undefined' && (
      Object.prototype.hasOwnProperty.call(mxStencilRegistry.stencils || {}, resolvedShape) ||
      (typeof mxStencilRegistry.getStencil === 'function' && !!mxStencilRegistry.getStencil(resolvedShape))
    );
    const namedStyles = graph.getStylesheet?.()?.styles || {};
    const unknownBareTokens = requestedStyle.split(';').map((token) => token.trim()).filter((token) => token && !token.includes('=') &&
      !Object.prototype.hasOwnProperty.call(namedStyles, token) &&
      !(typeof mxCellRenderer !== 'undefined' && Object.prototype.hasOwnProperty.call(mxCellRenderer.defaultShapes || {}, token)) &&
      !(typeof mxStencilRegistry !== 'undefined' && typeof mxStencilRegistry.getStencil === 'function' && !!mxStencilRegistry.getStencil(token))
    );
    return { resolved_shape: resolvedShape, renderer_registered: rendererRegistered, stencil_registered: stencilRegistered, unknown_bare_tokens: unknownBareTokens };
  `);
  if ((!renderability.renderer_registered && !renderability.stencil_registered) || renderability.unknown_bare_tokens.length) {
    const detail = renderability.unknown_bare_tokens.length
      ? `unknown style token(s): ${renderability.unknown_bare_tokens.join(", ")}`
      : `unregistered resolved renderer: ${renderability.resolved_shape}`;
    throw new Error(`The draw.io style for "${requestedShape}" is not renderable (${detail}). Scientific Illustrator refused the renderer's silent rectangle fallback. Use a baseline or registered capability, reconstruct the object from editable primitives, or insert only the smallest irreducible raster region.`);
  }
  const payload = JSON.stringify({ ...args, requested_shape: requestedShape, resolved_shape: renderability.resolved_shape, shape_validation: explicitStyleOverride || shapeContainsFullStyle ? "verified-explicit-style" : "registered-or-baseline", style });
  const value = await graphEval(`
    const a = ${payload};
    if (graph.getModel().getCell(a.id)) throw new Error('Cell id already exists: ' + a.id);
    const parent = graph.getDefaultParent();
    let cell;
    graph.getModel().beginUpdate();
    try { cell = graph.insertVertex(parent, a.id, a.label || '', Number(a.x), Number(a.y), Number(a.width), Number(a.height), a.style); }
    finally { graph.getModel().endUpdate(); }
    graph.setSelectionCell(cell);
    graph.scrollCellToVisible(cell);
    return { id: cell.id, label: graph.convertValueToString(cell), geometry: cell.geometry, style: cell.style, requested_shape: a.requested_shape, resolved_shape: a.resolved_shape, shape_validation: a.shape_validation };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function addEdge(args) {
  const payload = JSON.stringify({ ...args, style: edgeStyle(args) });
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    if (model.getCell(a.id)) throw new Error('Cell id already exists: ' + a.id);
    const source = model.getCell(a.source);
    const target = model.getCell(a.target);
    if (!source || !target) throw new Error('Missing edge endpoint: ' + (!source ? a.source : a.target));
    const parent = graph.getDefaultParent();
    let edge;
    model.beginUpdate();
    try {
      edge = graph.insertEdge(parent, a.id, a.label || '', source, target, a.style);
      if (a.waypoints && a.waypoints.length) {
        const geo = edge.getGeometry().clone();
        geo.points = a.waypoints.map((p) => new mxPoint(Number(p.x), Number(p.y)));
        model.setGeometry(edge, geo);
      }
    } finally { model.endUpdate(); }
    graph.setSelectionCell(edge);
    return { id: edge.id, source: source.id, target: target.id, label: graph.convertValueToString(edge), style: edge.style };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function addTable(args) {
  const data = args.data || [];
  if (data.length > args.rows) throw new Error(`Table data has ${data.length} rows but rows=${args.rows}.`);
  for (let row = 0; row < data.length; row += 1) {
    if ((data[row] || []).length > args.columns) throw new Error(`Table data row ${row + 1} has more than columns=${args.columns} values.`);
  }
  const payload = JSON.stringify(args);
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    if (model.getCell(a.id)) throw new Error('Cell id already exists: ' + a.id);
    const parent = graph.getDefaultParent();
    const doc = mxUtils.createXmlDocument();
    const metadata = doc.createElement('object');
    metadata.setAttribute('label', '');
    metadata.setAttribute('scientificIllustratorType', 'table');
    metadata.setAttribute('rows', String(a.rows));
    metadata.setAttribute('columns', String(a.columns));
    const group = new mxCell(metadata, new mxGeometry(Number(a.x), Number(a.y), Number(a.width), Number(a.height)), 'group;container=1;collapsible=0;recursiveResize=0;');
    group.setId(a.id);
    group.setVertex(true);
    const cellWidth = Number(a.width) / Number(a.columns);
    const cellHeight = Number(a.height) / Number(a.rows);
    const ids = [];
    model.beginUpdate();
    try {
      model.add(parent, group);
      for (let row = 1; row <= Number(a.rows); row += 1) {
        for (let column = 1; column <= Number(a.columns); column += 1) {
          const isHeader = row <= Number(a.header_rows ?? 1);
          const isBand = !isHeader && !!a.banded_rows && ((row - Number(a.header_rows ?? 1)) % 2 === 0);
          const fill = isHeader ? (a.header_fill_color || '#D9EAF7') : isBand ? (a.band_fill_color || '#F7FAFC') : (a.fill_color || '#FFFFFF');
          const font = isHeader ? (a.header_font_color || '#1F2937') : (a.font_color || '#1F2937');
          const bold = isHeader && a.header_bold !== false ? 1 : 0;
          const style = 'rounded=0;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;' +
            'fillColor=' + fill + ';strokeColor=' + (a.stroke_color || '#6B7280') + ';strokeWidth=' + Number(a.stroke_width ?? 1) + ';' +
            'fontColor=' + font + ';fontSize=' + Number(a.font_size ?? 12) + ';fontStyle=' + bold + ';spacing=4;';
          const id = a.id + '-r' + row + '-c' + column;
          const raw = a.data?.[row - 1]?.[column - 1];
          const label = raw === undefined || raw === null ? '' : String(raw);
          graph.insertVertex(group, id, label, (column - 1) * cellWidth, (row - 1) * cellHeight, cellWidth, cellHeight, style);
          ids.push(id);
        }
      }
    } finally { model.endUpdate(); }
    graph.setSelectionCell(group);
    graph.scrollCellToVisible(group);
    return { id: group.id, type: 'table', rows: Number(a.rows), columns: Number(a.columns), cell_ids: ids, geometry: group.geometry };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function updateTableCell(args) {
  const payload = JSON.stringify({ ...args, id: `${args.table_id}-r${args.row}-c${args.column}` });
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    const cell = model.getCell(a.id);
    if (!cell) throw new Error('Table cell not found: ' + a.id);
    const set = (style, key, value) => {
      if (value === undefined || value === null) return style || '';
      const parts = String(style || '').split(';').filter(Boolean).filter((entry) => entry.split('=', 1)[0] !== key);
      parts.push(key + '=' + value);
      return parts.join(';') + ';';
    };
    model.beginUpdate();
    try {
      if (a.label !== undefined) graph.cellLabelChanged(cell, a.label, false);
      let style = a.style !== undefined ? a.style : (cell.style || '');
      style = set(style, 'fillColor', a.fill_color);
      style = set(style, 'strokeColor', a.stroke_color);
      style = set(style, 'fontColor', a.font_color);
      style = set(style, 'fontSize', a.font_size);
      model.setStyle(cell, style);
    } finally { model.endUpdate(); }
    graph.setSelectionCell(cell);
    graph.scrollCellToVisible(cell);
    return { id: cell.id, table_id: a.table_id, row: Number(a.row), column: Number(a.column), label: graph.convertValueToString(cell), style: cell.style };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function updateTableLayout(args) {
  if (!Array.isArray(args.column_widths) && !Array.isArray(args.row_heights)) {
    throw new Error("Provide column_widths and/or row_heights.");
  }
  const payload = JSON.stringify(args);
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    const table = model.getCell(a.table_id);
    if (!table) throw new Error('Table not found: ' + a.table_id);
    const semanticType = table.value?.getAttribute?.('scientificIllustratorType') || '';
    if (semanticType !== 'table') throw new Error('Cell is not a Scientific Illustrator editable table: ' + a.table_id);
    const rows = Number(table.value.getAttribute('rows'));
    const columns = Number(table.value.getAttribute('columns'));
    const getCell = (row, column) => {
      const cell = model.getCell(a.table_id + '-r' + row + '-c' + column);
      if (!cell?.geometry) throw new Error('Table cell is missing geometry: ' + a.table_id + '-r' + row + '-c' + column);
      return cell;
    };
    const currentWidths = Array.from({ length: columns }, (_, index) => Number(getCell(1, index + 1).geometry.width));
    const currentHeights = Array.from({ length: rows }, (_, index) => Number(getCell(index + 1, 1).geometry.height));
    const widths = a.column_widths === undefined ? currentWidths : a.column_widths.map(Number);
    const heights = a.row_heights === undefined ? currentHeights : a.row_heights.map(Number);
    if (widths.length !== columns) throw new Error('column_widths count ' + widths.length + ' does not match table column count ' + columns + '.');
    if (heights.length !== rows) throw new Error('row_heights count ' + heights.length + ' does not match table row count ' + rows + '.');
    if (widths.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error('Every column width must be a finite positive number.');
    if (heights.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error('Every row height must be a finite positive number.');
    const xOffsets = widths.map((_, index) => widths.slice(0, index).reduce((sum, value) => sum + value, 0));
    const yOffsets = heights.map((_, index) => heights.slice(0, index).reduce((sum, value) => sum + value, 0));
    model.beginUpdate();
    try {
      for (let row = 1; row <= rows; row += 1) {
        for (let column = 1; column <= columns; column += 1) {
          const cell = getCell(row, column);
          const geometry = cell.geometry.clone();
          geometry.x = xOffsets[column - 1];
          geometry.y = yOffsets[row - 1];
          geometry.width = widths[column - 1];
          geometry.height = heights[row - 1];
          model.setGeometry(cell, geometry);
        }
      }
      const tableGeometry = table.geometry.clone();
      tableGeometry.width = widths.reduce((sum, value) => sum + value, 0);
      tableGeometry.height = heights.reduce((sum, value) => sum + value, 0);
      model.setGeometry(table, tableGeometry);
      const metadata = table.value.cloneNode(true);
      metadata.setAttribute('scientificIllustratorColumnWidths', JSON.stringify(widths));
      metadata.setAttribute('scientificIllustratorRowHeights', JSON.stringify(heights));
      model.setValue(table, metadata);
    } finally { model.endUpdate(); }
    graph.setSelectionCell(table);
    graph.scrollCellToVisible(table);
    return {
      id: table.id,
      type: 'table',
      rows,
      columns,
      column_widths: widths,
      row_heights: heights,
      geometry: { x: table.geometry.x, y: table.geometry.y, width: table.geometry.width, height: table.geometry.height },
    };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

function buildChartPlan(args) {
  const categories = args.categories.map((value) => String(value));
  const series = args.series.map((item) => ({ name: String(item.name), values: item.values.map(Number) }));
  for (const item of series) {
    if (item.values.length !== categories.length) throw new Error(`Chart series '${item.name}' has ${item.values.length} values but there are ${categories.length} categories.`);
    if (item.values.some((value) => !Number.isFinite(value))) throw new Error(`Chart series '${item.name}' contains a non-finite value.`);
  }
  const palette = args.palette?.length ? args.palette : ["#4E79A7", "#E15759", "#59A14F", "#F28E2B", "#B07AA1", "#76B7B2", "#EDC948"];
  const titleHeight = args.title ? 32 : 8;
  const legendWidth = args.show_legend === false ? 10 : Math.min(140, Math.max(90, args.width * 0.2));
  const margins = { left: 62, right: legendWidth, top: titleHeight + 12, bottom: 58 };
  const plot = { x: margins.left, y: margins.top, width: Math.max(80, args.width - margins.left - margins.right), height: Math.max(60, args.height - margins.top - margins.bottom) };
  const values = series.flatMap((item) => item.values);
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (minimum === maximum) maximum = minimum + 1;
  const range = maximum - minimum;
  const yFor = (value) => plot.y + ((maximum - value) / range) * plot.height;
  const xFor = (value, minX, maxX) => plot.x + ((value - minX) / (maxX - minX || 1)) * plot.width;
  const vertices = [];
  const edges = [];
  const textStyle = "text;strokeColor=none;fillColor=none;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fontColor=#1F2937;fontSize=11;";
  const addVertex = (id, label, x, y, width, height, style) => vertices.push({ id, label, x, y, width, height, style });
  const addLineRect = (id, x, y, width, height, color = "#D1D5DB") => addVertex(id, "", x, y, Math.max(0.8, width), Math.max(0.8, height), `rounded=0;fillColor=${color};strokeColor=none;`);

  if (args.title) addVertex(`${args.id}-title`, args.title, 0, 0, args.width, titleHeight, `${textStyle}fontSize=16;fontStyle=1;`);
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = minimum + (range * tick) / 4;
    const y = yFor(value);
    addLineRect(`${args.id}-grid-${tick}`, plot.x, y, plot.width, 1, tick === 0 && minimum === 0 ? "#4B5563" : "#D1D5DB");
    addVertex(`${args.id}-value-label-${tick}`, Number(value.toPrecision(4)).toString(), 0, y - 9, plot.x - 8, 18, `${textStyle}align=right;`);
  }
  addLineRect(`${args.id}-y-axis`, plot.x, plot.y, 1.2, plot.height, "#374151");
  addLineRect(`${args.id}-x-axis`, plot.x, yFor(0), plot.width, 1.2, "#374151");

  if (args.chart_type === "column_clustered") {
    const clusterWidth = plot.width / categories.length;
    const barWidth = Math.max(2, (clusterWidth * 0.72) / series.length);
    categories.forEach((category, categoryIndex) => {
      addVertex(`${args.id}-category-${categoryIndex + 1}`, category, plot.x + categoryIndex * clusterWidth, plot.y + plot.height + 7, clusterWidth, 28, textStyle);
      series.forEach((item, seriesIndex) => {
        const value = item.values[categoryIndex];
        const base = yFor(0);
        const valueY = yFor(value);
        const x = plot.x + categoryIndex * clusterWidth + clusterWidth * 0.14 + seriesIndex * barWidth;
        addVertex(`${args.id}-s${seriesIndex + 1}-p${categoryIndex + 1}`, "", x, Math.min(base, valueY), barWidth * 0.9, Math.max(1, Math.abs(base - valueY)), `rounded=0;fillColor=${palette[seriesIndex % palette.length]};strokeColor=${palette[seriesIndex % palette.length]};`);
      });
    });
  } else if (args.chart_type === "bar_clustered") {
    const clusterHeight = plot.height / categories.length;
    const barHeight = Math.max(2, (clusterHeight * 0.72) / series.length);
    const xValue = (value) => plot.x + ((value - minimum) / range) * plot.width;
    categories.forEach((category, categoryIndex) => {
      addVertex(`${args.id}-category-${categoryIndex + 1}`, category, 0, plot.y + categoryIndex * clusterHeight, plot.x - 8, clusterHeight, `${textStyle}align=right;`);
      series.forEach((item, seriesIndex) => {
        const value = item.values[categoryIndex];
        const base = xValue(0);
        const valueX = xValue(value);
        const y = plot.y + categoryIndex * clusterHeight + clusterHeight * 0.14 + seriesIndex * barHeight;
        addVertex(`${args.id}-s${seriesIndex + 1}-p${categoryIndex + 1}`, "", Math.min(base, valueX), y, Math.max(1, Math.abs(base - valueX)), barHeight * 0.9, `rounded=0;fillColor=${palette[seriesIndex % palette.length]};strokeColor=${palette[seriesIndex % palette.length]};`);
      });
    });
  } else {
    const numericCategories = categories.map(Number);
    const scatter = args.chart_type === "scatter" && numericCategories.every(Number.isFinite);
    const minX = scatter ? Math.min(...numericCategories) : 0;
    const maxX = scatter ? Math.max(...numericCategories) : Math.max(1, categories.length - 1);
    categories.forEach((category, categoryIndex) => {
      const pointX = scatter ? xFor(numericCategories[categoryIndex], minX, maxX) : plot.x + (categories.length === 1 ? plot.width / 2 : (categoryIndex / (categories.length - 1)) * plot.width);
      addVertex(`${args.id}-category-${categoryIndex + 1}`, category, pointX - 30, plot.y + plot.height + 7, 60, 24, textStyle);
    });
    series.forEach((item, seriesIndex) => {
      item.values.forEach((value, categoryIndex) => {
        const pointX = scatter ? xFor(numericCategories[categoryIndex], minX, maxX) : plot.x + (categories.length === 1 ? plot.width / 2 : (categoryIndex / (categories.length - 1)) * plot.width);
        const pointY = yFor(value);
        const pointId = `${args.id}-s${seriesIndex + 1}-p${categoryIndex + 1}`;
        addVertex(pointId, "", pointX - 4, pointY - 4, 8, 8, `ellipse;fillColor=${palette[seriesIndex % palette.length]};strokeColor=${palette[seriesIndex % palette.length]};`);
        if (args.chart_type === "line" && categoryIndex > 0) {
          edges.push({ id: `${args.id}-s${seriesIndex + 1}-line-${categoryIndex}`, source: `${args.id}-s${seriesIndex + 1}-p${categoryIndex}`, target: pointId, style: `edgeStyle=none;rounded=0;html=1;endArrow=none;startArrow=none;strokeWidth=2;strokeColor=${palette[seriesIndex % palette.length]};` });
        }
      });
    });
  }

  if (args.show_legend !== false) {
    series.forEach((item, seriesIndex) => {
      const y = plot.y + seriesIndex * 24;
      addVertex(`${args.id}-legend-swatch-${seriesIndex + 1}`, "", plot.x + plot.width + 18, y + 6, 12, 12, `rounded=0;fillColor=${palette[seriesIndex % palette.length]};strokeColor=${palette[seriesIndex % palette.length]};`);
      addVertex(`${args.id}-legend-label-${seriesIndex + 1}`, item.name, plot.x + plot.width + 34, y, legendWidth - 40, 24, `${textStyle}align=left;`);
    });
  }
  if (args.category_axis_title) addVertex(`${args.id}-category-axis-title`, args.category_axis_title, plot.x, args.height - 24, plot.width, 20, `${textStyle}fontStyle=1;`);
  if (args.value_axis_title) addVertex(`${args.id}-value-axis-title`, args.value_axis_title, -26, plot.y + plot.height / 2 - 12, plot.height, 24, `${textStyle}fontStyle=1;rotation=270;`);
  return { vertices, edges, plot, minimum, maximum };
}

async function addChart(args) {
  const plan = buildChartPlan(args);
  const payload = JSON.stringify({ ...args, plan });
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    if (model.getCell(a.id)) throw new Error('Cell id already exists: ' + a.id);
    const parent = graph.getDefaultParent();
    const doc = mxUtils.createXmlDocument();
    const metadata = doc.createElement('object');
    metadata.setAttribute('label', '');
    metadata.setAttribute('scientificIllustratorType', 'chart');
    metadata.setAttribute('chartType', a.chart_type);
    const group = new mxCell(metadata, new mxGeometry(Number(a.x), Number(a.y), Number(a.width), Number(a.height)), 'group;container=1;collapsible=0;recursiveResize=0;');
    group.setId(a.id);
    group.setVertex(true);
    model.beginUpdate();
    try {
      model.add(parent, group);
      for (const item of a.plan.vertices) graph.insertVertex(group, item.id, item.label || '', Number(item.x), Number(item.y), Number(item.width), Number(item.height), item.style);
      for (const item of a.plan.edges) {
        const source = model.getCell(item.source);
        const target = model.getCell(item.target);
        graph.insertEdge(group, item.id, '', source, target, item.style);
      }
    } finally { model.endUpdate(); }
    graph.setSelectionCell(group);
    graph.scrollCellToVisible(group);
    return { id: group.id, type: 'chart', chart_type: a.chart_type, editable_elements: a.plan.vertices.length + a.plan.edges.length, series_count: a.series.length, category_count: a.categories.length, geometry: group.geometry };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function duplicateCell(args) {
  const payload = JSON.stringify(args);
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    const source = model.getCell(a.id);
    if (!source) throw new Error('Cell not found: ' + a.id);
    if (model.getCell(a.new_id)) throw new Error('Cell id already exists: ' + a.new_id);
    const clone = model.cloneCells([source], true)[0];
    const rename = (cell, fallback) => {
      const oldId = String(cell.id || '');
      const nextId = oldId.startsWith(a.id) ? a.new_id + oldId.slice(a.id.length) : fallback;
      cell.setId(nextId);
      for (let index = 0; index < cell.getChildCount(); index += 1) rename(cell.getChildAt(index), nextId + '-' + (index + 1));
    };
    rename(clone, a.new_id);
    const geo = clone.geometry?.clone();
    if (geo) {
      if (a.x !== undefined) geo.x = Number(a.x); else geo.x += 20;
      if (a.y !== undefined) geo.y = Number(a.y); else geo.y += 20;
      if (a.width !== undefined) geo.width = Number(a.width);
      if (a.height !== undefined) geo.height = Number(a.height);
      clone.setGeometry(geo);
    }
    model.beginUpdate();
    try { model.add(source.parent || graph.getDefaultParent(), clone); }
    finally { model.endUpdate(); }
    graph.setSelectionCell(clone);
    graph.scrollCellToVisible(clone);
    return { id: clone.id, source_id: a.id, geometry: clone.geometry, child_count: clone.getChildCount() };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function groupCells(args) {
  const payload = JSON.stringify(args);
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    if (model.getCell(a.id)) throw new Error('Cell id already exists: ' + a.id);
    const cells = a.cell_ids.map((id) => model.getCell(id));
    const missing = a.cell_ids.filter((id, index) => !cells[index]);
    if (missing.length) throw new Error('Cells not found: ' + missing.join(', '));
    const group = new mxCell('', new mxGeometry(), 'group;container=1;collapsible=0;recursiveResize=0;');
    group.setId(a.id);
    group.setVertex(true);
    const result = graph.groupCells(group, 0, cells);
    graph.setSelectionCell(result);
    graph.scrollCellToVisible(result);
    return { id: result.id, member_ids: a.cell_ids, child_count: result.getChildCount(), geometry: result.geometry };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function ungroupCell(args) {
  const payload = JSON.stringify(args);
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    const group = model.getCell(a.id);
    if (!group) throw new Error('Cell not found: ' + a.id);
    if (!group.getChildCount()) throw new Error('Cell is not a group or has no members: ' + a.id);
    const members = graph.ungroupCells([group]);
    graph.setSelectionCells(members);
    return { id: a.id, ungrouped: true, member_ids: members.map((cell) => cell.id), member_count: members.length };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function setZOrder(args) {
  const payload = JSON.stringify(args);
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    const cell = model.getCell(a.id);
    if (!cell) throw new Error('Cell not found: ' + a.id);
    const parent = cell.parent;
    if (!parent) throw new Error('Cell has no parent: ' + a.id);
    const repeat = Math.max(1, Number(a.repeat || 1));
    model.beginUpdate();
    try {
      for (let step = 0; step < repeat; step += 1) {
        const index = parent.getIndex(cell);
        let target = index;
        if (a.command === 'bring_to_front') target = parent.getChildCount() - 1;
        else if (a.command === 'send_to_back') target = 0;
        else if (a.command === 'bring_forward') target = Math.min(parent.getChildCount() - 1, index + 1);
        else if (a.command === 'send_backward') target = Math.max(0, index - 1);
        model.add(parent, cell, target);
      }
    } finally { model.endUpdate(); }
    graph.setSelectionCell(cell);
    return { id: cell.id, command: a.command, z_order_index: parent.getIndex(cell), sibling_count: parent.getChildCount() };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function alignCells(args) {
  const payload = JSON.stringify(args);
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    const cells = a.cell_ids.map((id) => model.getCell(id));
    const missing = a.cell_ids.filter((id, index) => !cells[index]);
    if (missing.length) throw new Error('Cells not found: ' + missing.join(', '));
    for (let first = 0; first < cells.length; first += 1) {
      for (let second = first + 1; second < cells.length; second += 1) {
        if (model.isAncestor(cells[first], cells[second]) || model.isAncestor(cells[second], cells[first])) {
          throw new Error('Do not align an ancestor group and its descendant in the same call: ' + cells[first].id + ', ' + cells[second].id);
        }
      }
    }
    graph.view.validate();
    const scale = graph.view.scale || 1;
    const translate = graph.view.translate || { x: 0, y: 0 };
    const boundsFor = (cell) => {
      const state = graph.view.getState(cell);
      if (!state) throw new Error('No rendered bounds are available for cell: ' + cell.id);
      return { x: state.x / scale - translate.x, y: state.y / scale - translate.y, width: state.width / scale, height: state.height / scale };
    };
    const bounds = cells.map(boundsFor);
    const selection = {
      left: Math.min(...bounds.map((bound) => bound.x)),
      top: Math.min(...bounds.map((bound) => bound.y)),
      right: Math.max(...bounds.map((bound) => bound.x + bound.width)),
      bottom: Math.max(...bounds.map((bound) => bound.y + bound.height)),
    };
    const page = { left: 0, top: 0, right: Number(graph.pageFormat?.width || 850) * Number(graph.pageScale || 1), bottom: Number(graph.pageFormat?.height || 1100) * Number(graph.pageScale || 1) };
    const frame = a.relative_to === 'page' ? page : selection;
    const target = {
      left: frame.left,
      center: (frame.left + frame.right) / 2,
      right: frame.right,
      top: frame.top,
      middle: (frame.top + frame.bottom) / 2,
      bottom: frame.bottom,
    }[a.alignment];
    model.beginUpdate();
    try {
      cells.forEach((cell, index) => {
        const bound = bounds[index];
        let dx = 0;
        let dy = 0;
        if (a.alignment === 'left') dx = target - bound.x;
        else if (a.alignment === 'center') dx = target - (bound.x + bound.width / 2);
        else if (a.alignment === 'right') dx = target - (bound.x + bound.width);
        else if (a.alignment === 'top') dy = target - bound.y;
        else if (a.alignment === 'middle') dy = target - (bound.y + bound.height / 2);
        else if (a.alignment === 'bottom') dy = target - (bound.y + bound.height);
        graph.moveCells([cell], dx, dy, false, null, null);
      });
    } finally { model.endUpdate(); }
    graph.view.validate();
    const items = cells.map((cell) => ({ id: cell.id, geometry: cell.geometry ? { x: cell.geometry.x, y: cell.geometry.y, width: cell.geometry.width, height: cell.geometry.height } : null, bounds: boundsFor(cell) }));
    graph.setSelectionCells(cells);
    return { alignment: a.alignment, relative_to: a.relative_to || 'selection', target_coordinate: target, cells: items };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function distributeCells(args) {
  const payload = JSON.stringify(args);
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    const cells = a.cell_ids.map((id) => model.getCell(id));
    const missing = a.cell_ids.filter((id, index) => !cells[index]);
    if (missing.length) throw new Error('Cells not found: ' + missing.join(', '));
    for (let first = 0; first < cells.length; first += 1) {
      for (let second = first + 1; second < cells.length; second += 1) {
        if (model.isAncestor(cells[first], cells[second]) || model.isAncestor(cells[second], cells[first])) {
          throw new Error('Do not distribute an ancestor group and its descendant in the same call: ' + cells[first].id + ', ' + cells[second].id);
        }
      }
    }
    graph.view.validate();
    const scale = graph.view.scale || 1;
    const translate = graph.view.translate || { x: 0, y: 0 };
    const boundsFor = (cell) => {
      const state = graph.view.getState(cell);
      if (!state) throw new Error('No rendered bounds are available for cell: ' + cell.id);
      return { x: state.x / scale - translate.x, y: state.y / scale - translate.y, width: state.width / scale, height: state.height / scale };
    };
    const axis = a.direction === 'vertical' ? 'y' : 'x';
    const sizeKey = a.direction === 'vertical' ? 'height' : 'width';
    const pageEnd = a.direction === 'vertical'
      ? Number(graph.pageFormat?.height || 1100) * Number(graph.pageScale || 1)
      : Number(graph.pageFormat?.width || 850) * Number(graph.pageScale || 1);
    const ordered = cells.map((cell) => ({ cell, bound: boundsFor(cell) })).sort((first, second) => first.bound[axis] - second.bound[axis]);
    const selectionStart = ordered[0].bound[axis];
    const selectionEnd = Math.max(...ordered.map((item) => item.bound[axis] + item.bound[sizeKey]));
    const start = a.relative_to === 'page' ? 0 : selectionStart;
    const end = a.relative_to === 'page' ? pageEnd : selectionEnd;
    const totalSize = ordered.reduce((sum, item) => sum + item.bound[sizeKey], 0);
    const gap = (end - start - totalSize) / (ordered.length - 1);
    let cursor = start;
    model.beginUpdate();
    try {
      ordered.forEach((item) => {
        const delta = cursor - item.bound[axis];
        graph.moveCells([item.cell], a.direction === 'horizontal' ? delta : 0, a.direction === 'vertical' ? delta : 0, false, null, null);
        cursor += item.bound[sizeKey] + gap;
      });
    } finally { model.endUpdate(); }
    graph.view.validate();
    const items = ordered.map((item) => ({ id: item.cell.id, geometry: item.cell.geometry ? { x: item.cell.geometry.x, y: item.cell.geometry.y, width: item.cell.geometry.width, height: item.cell.geometry.height } : null, bounds: boundsFor(item.cell) }));
    graph.setSelectionCells(cells);
    return { direction: a.direction, relative_to: a.relative_to || 'selection', equal_gap: gap, cells: items };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function updateCell(args) {
  const payload = JSON.stringify(args);
  const value = await graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    const cell = model.getCell(a.id);
    if (!cell) throw new Error('Cell not found: ' + a.id);
    model.beginUpdate();
    try {
      if (a.label !== undefined) graph.cellLabelChanged(cell, a.label, false);
      if (a.style !== undefined) model.setStyle(cell, a.style);
      if (a.x !== undefined || a.y !== undefined || a.width !== undefined || a.height !== undefined) {
        if (!cell.geometry) throw new Error('Cell has no geometry: ' + a.id);
        const geo = cell.geometry.clone();
        if (a.x !== undefined) geo.x = Number(a.x);
        if (a.y !== undefined) geo.y = Number(a.y);
        if (a.width !== undefined) geo.width = Number(a.width);
        if (a.height !== undefined) geo.height = Number(a.height);
        model.setGeometry(cell, geo);
      }
    } finally { model.endUpdate(); }
    graph.setSelectionCell(cell);
    graph.scrollCellToVisible(cell);
    return { id: cell.id, label: graph.convertValueToString(cell), geometry: cell.geometry, style: cell.style };
  `);
  await sleep(args.pause_after_ms ?? live.stepDelayMs);
  return value;
}

async function fitView(zoomPercent) {
  return graphEval(`
    const zoom = ${zoomPercent === undefined ? "null" : Number(zoomPercent)};
    if (zoom == null) graph.fit(20, false, 20, true, false, true);
    else graph.zoomTo(zoom / 100, true);
    return { zoom_percent: Math.round(graph.view.scale * 100) };
  `);
}

async function auditFigure(args = {}) {
  const payload = JSON.stringify({
    alignment_tolerance: args.alignment_tolerance ?? 1,
    endpoint_clearance: args.endpoint_clearance ?? 2,
    text_overflow_tolerance: args.text_overflow_tolerance ?? 2,
    large_raster_area_ratio: args.large_raster_area_ratio ?? 0.08,
    max_findings: args.max_findings ?? 300,
  });
  return graphEval(`
    const a = ${payload};
    const model = graph.getModel();
    const root = graph.getDefaultParent();
    graph.view.validate();
    const scale = graph.view.scale || 1;
    const translate = graph.view.translate || { x: 0, y: 0 };
    const pageWidth = Number(graph.pageFormat?.width || 850) * Number(graph.pageScale || 1);
    const pageHeight = Number(graph.pageFormat?.height || 1100) * Number(graph.pageScale || 1);
    const pageArea = Math.max(1, pageWidth * pageHeight);
    const findings = [];
    const addFinding = (category, severity, objects, evidence, correction, acceptance) => {
      if (findings.length >= Number(a.max_findings)) return;
      findings.push({ category, severity, objects: Array.from(objects || []).map(String), evidence, correction, acceptance });
    };
    const allCells = [];
    const visit = (parent) => {
      for (let index = 0; index < parent.getChildCount(); index += 1) {
        const child = parent.getChildAt(index);
        if (child.vertex || child.edge) allCells.push(child);
        if (child.getChildCount?.()) visit(child);
      }
    };
    visit(root);
    const vertices = allCells.filter((cell) => cell.vertex);
    const edges = allCells.filter((cell) => cell.edge);
    const modelPoint = (point) => ({ x: point.x / scale - translate.x, y: point.y / scale - translate.y });
    const boundsFor = (cell) => {
      const state = graph.view.getState(cell);
      if (state) return { x: state.x / scale - translate.x, y: state.y / scale - translate.y, width: state.width / scale, height: state.height / scale };
      const geometry = cell.geometry;
      if (!geometry) return null;
      let x = Number(geometry.x || 0);
      let y = Number(geometry.y || 0);
      let parent = cell.parent;
      while (parent && parent !== root) {
        if (parent.geometry) { x += Number(parent.geometry.x || 0); y += Number(parent.geometry.y || 0); }
        parent = parent.parent;
      }
      return { x, y, width: Number(geometry.width || 0), height: Number(geometry.height || 0) };
    };
    const semanticType = (cell) => cell.value?.getAttribute?.('scientificIllustratorType') || '';
    const semanticAncestor = (cell) => {
      let current = cell;
      while (current && current !== root) {
        const type = semanticType(current);
        if (type === 'table' || type === 'chart') return current.id;
        current = current.parent;
      }
      return '';
    };
    const styleFor = (cell) => graph.getCellStyle(cell) || {};
    const isPicture = (cell) => cell.vertex && (styleFor(cell).shape === 'image' || /(?:^|;)shape=image(?:;|$)/.test(String(cell.style || '')));
    const routeFor = (edge) => {
      const state = graph.view.getState(edge);
      if (state?.absolutePoints?.length >= 2) return state.absolutePoints.filter(Boolean).map(modelPoint);
      const geometry = edge.geometry;
      const points = [];
      if (geometry?.sourcePoint) points.push({ x: Number(geometry.sourcePoint.x), y: Number(geometry.sourcePoint.y) });
      if (geometry?.points?.length) points.push(...geometry.points.map((point) => ({ x: Number(point.x), y: Number(point.y) })));
      if (geometry?.targetPoint) points.push({ x: Number(geometry.targetPoint.x), y: Number(geometry.targetPoint.y) });
      return points;
    };
    const inside = (point, rect, margin = 0) => point.x > rect.x + margin && point.x < rect.x + rect.width - margin && point.y > rect.y + margin && point.y < rect.y + rect.height - margin;
    const segmentIntersectsRect = (first, second, rect, inset) => {
      let margin = Math.max(0, Number(inset || 0));
      if (rect.width <= 2 * margin || rect.height <= 2 * margin) margin = 0;
      const left = rect.x + margin;
      const right = rect.x + rect.width - margin;
      const top = rect.y + margin;
      const bottom = rect.y + rect.height - margin;
      if (first.x > left && first.x < right && first.y > top && first.y < bottom) return true;
      if (second.x > left && second.x < right && second.y > top && second.y < bottom) return true;
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const p = [-dx, dx, -dy, dy];
      const q = [first.x - left, right - first.x, first.y - top, bottom - first.y];
      let minimum = 0;
      let maximum = 1;
      for (let index = 0; index < 4; index += 1) {
        if (Math.abs(p[index]) < 1e-9) { if (q[index] < 0) return false; continue; }
        const ratio = q[index] / p[index];
        if (p[index] < 0) minimum = Math.max(minimum, ratio);
        else maximum = Math.min(maximum, ratio);
        if (minimum > maximum) return false;
      }
      return maximum - minimum > 1e-6;
    };
    const strictSegmentCrossing = (a1, a2, b1, b2, clearance) => {
      const ax = a2.x - a1.x;
      const ay = a2.y - a1.y;
      const bx = b2.x - b1.x;
      const by = b2.y - b1.y;
      const denominator = ax * by - ay * bx;
      if (Math.abs(denominator) < 1e-9) return null;
      const cx = b1.x - a1.x;
      const cy = b1.y - a1.y;
      const firstRatio = (cx * by - cy * bx) / denominator;
      const secondRatio = (cx * ay - cy * ax) / denominator;
      if (firstRatio <= 1e-6 || firstRatio >= 1 - 1e-6 || secondRatio <= 1e-6 || secondRatio >= 1 - 1e-6) return null;
      const firstLength = Math.hypot(ax, ay);
      const secondLength = Math.hypot(bx, by);
      const distanceFromEnds = Math.min(firstRatio * firstLength, (1 - firstRatio) * firstLength, secondRatio * secondLength, (1 - secondRatio) * secondLength);
      if (distanceFromEnds <= clearance) return null;
      return { x: a1.x + firstRatio * ax, y: a1.y + firstRatio * ay };
    };

    for (const cell of vertices) {
      const bounds = boundsFor(cell);
      if (!bounds) continue;
      if (graph.pageVisible && (bounds.x < -Number(a.alignment_tolerance) || bounds.y < -Number(a.alignment_tolerance) || bounds.x + bounds.width > pageWidth + Number(a.alignment_tolerance) || bounds.y + bounds.height > pageHeight + Number(a.alignment_tolerance))) {
        addFinding('outside-page', 'hard', [cell.id], 'Bounds [' + [bounds.x, bounds.y, bounds.width, bounds.height].map((value) => Math.round(value * 100) / 100).join(',') + '] exceed the current ' + pageWidth + ' x ' + pageHeight + ' draw.io page.', 'Move or resize the named cell inside the page, or explicitly change the planned page size.', 'Every visible object remains inside the intended page within the alignment tolerance.');
      }
      const label = String(graph.convertValueToString(cell) || '').trim();
      const state = graph.view.getState(cell);
      const textBounds = state?.text?.boundingBox;
      if (label && textBounds) {
        const renderedText = { x: textBounds.x / scale - translate.x, y: textBounds.y / scale - translate.y, width: textBounds.width / scale, height: textBounds.height / scale };
        const tolerance = Number(a.text_overflow_tolerance);
        if (renderedText.x < bounds.x - tolerance || renderedText.y < bounds.y - tolerance || renderedText.x + renderedText.width > bounds.x + bounds.width + tolerance || renderedText.y + renderedText.height > bounds.y + bounds.height + tolerance) {
          addFinding('text-overflow', 'hard', [cell.id], 'Rendered text bounds [' + [renderedText.x, renderedText.y, renderedText.width, renderedText.height].map((value) => Math.round(value * 100) / 100).join(',') + '] exceed cell bounds [' + [bounds.x, bounds.y, bounds.width, bounds.height].map((value) => Math.round(value * 100) / 100).join(',') + '].', 'Adjust the named cell geometry, spacing, font size, line breaks, or wrapping while keeping the text editable.', 'The renderer shows the complete label inside its planned bounds with no unintended wrap or clipping.');
        }
      }
    }

    const pictureAudits = [];
    for (const cell of vertices.filter(isPicture)) {
      const bounds = boundsFor(cell) || { width: 0, height: 0 };
      const get = (name) => String(cell.value?.getAttribute?.(name) || '');
      const reason = get('scientificIllustratorRasterReason');
      const tight = get('scientificIllustratorSourceTightlyCropped');
      const atomic = get('scientificIllustratorAtomicRasterUnit');
      const containsReconstructable = get('scientificIllustratorContainsReconstructableContent');
      const decomposition = get('scientificIllustratorDecompositionNote');
      const areaRatio = Number(bounds.width || 0) * Number(bounds.height || 0) / pageArea;
      pictureAudits.push({ id: cell.id, area_ratio: Math.round(areaRatio * 10000) / 10000, raster_reason: reason, source_is_tightly_cropped: tight, atomic_raster_unit: atomic, contains_reconstructable_content: containsReconstructable, decomposition_note: decomposition });
      if (!reason.trim()) addFinding('raster-missing-reason', 'hard', [cell.id], 'No serialized irreducibility reason is present.', 'Replace or retag the image with a precise raster_reason.', 'The image has a specific irreducibility reason.');
      if (tight.toLowerCase() !== 'true') addFinding('raster-not-tight', 'hard', [cell.id], "source_is_tightly_cropped is '" + tight + "'.", 'Crop away every reconstructable border, label, arrow, legend, axis, or neighboring image.', 'The image contains only its atomic visual field.');
      if (atomic.toLowerCase() !== 'true') addFinding('raster-not-atomic', 'hard', [cell.id], "atomic_raster_unit is '" + atomic + "'.", 'Split the image into one cell per microscopy field, mask, heatmap, photograph, or other irreducible datum.', 'Each retained image is one indivisible raster unit.');
      if (containsReconstructable.toLowerCase() !== 'false') addFinding('raster-contains-reconstructable-content', 'hard', [cell.id], "contains_reconstructable_content is '" + containsReconstructable + "'.", 'Rebuild all text, borders, arrows, legends, axes, tables, and regular plots as editable cells.', 'No retained image contains a reconstructable drawing primitive.');
      if (decomposition.trim().length < 8) addFinding('raster-missing-decomposition-note', 'hard', [cell.id], 'No useful decomposition note is serialized.', 'State what was separated and rebuilt as editable cells, or why no finer semantic split is possible.', 'A reviewer can verify the atomic decomposition decision from the note.');
      if (areaRatio > Number(a.large_raster_area_ratio)) addFinding('large-raster-surface', 'warning', [cell.id], 'Image occupies ' + Math.round(areaRatio * 1000) / 10 + '% of the page, above the review threshold.', 'Inspect the source at full resolution and split any independent subimages or reconstructable overlay.', 'The reviewer confirms the large image is still one atomic raster field.');
      const compositeText = [cell.id, reason, decomposition].join(' ');
      if (/(grid|montage|panel|comparison|stack|matrix|multi[- ]?image|multiple images|rows? of|columns? of)/i.test(compositeText)) addFinding('possible-composite-raster', 'hard', [cell.id], "The id, reason, or decomposition note suggests a composite raster: '" + compositeText + "'.", 'Split each independent image, mask, heatmap, or error map into its own image cell; recreate headings, grid, borders, and legend as editable cells.', 'No image id or audit note describes a grid, montage, stack, panel, comparison, matrix, or multiple-image region.');
    }

    const candidateVertices = vertices.filter((cell) => {
      const bounds = boundsFor(cell);
      const containerLike = /(^|[-_])(panel|background|bg|container|region|frame)([-_]|$)/i.test(String(cell.id || ''));
      return bounds && !containerLike && cell.getChildCount() === 0 && bounds.width > 2 && bounds.height > 2 && bounds.width * bounds.height / pageArea < 0.18;
    });
    const edgeRoutes = new Map(edges.map((edge) => [edge.id, routeFor(edge)]));
    for (const edge of edges) {
      const route = edgeRoutes.get(edge.id) || [];
      if (route.length < 2) continue;
      const edgeSemanticAncestor = semanticAncestor(edge);
      const edgeStyle = styleFor(edge);
      const endpoints = [
        { label: 'start', point: route[0], hasArrow: !['', 'none'].includes(String(edgeStyle.startArrow || 'none').toLowerCase()) },
        { label: 'end', point: route[route.length - 1], hasArrow: !['', 'none'].includes(String(edgeStyle.endArrow || 'none').toLowerCase()) },
      ];
      for (const endpoint of endpoints) {
        if (!endpoint.hasArrow) continue;
        for (const target of candidateVertices) {
          if (target === edge.source || target === edge.target) continue;
          if (edgeSemanticAncestor && edgeSemanticAncestor === semanticAncestor(target)) continue;
          const bounds = boundsFor(target);
          if (inside(endpoint.point, bounds, Number(a.endpoint_clearance))) {
            addFinding('arrowhead-intrusion', 'hard', [edge.id, target.id], endpoint.label + ' arrow endpoint (' + Math.round(endpoint.point.x * 100) / 100 + ',' + Math.round(endpoint.point.y * 100) / 100 + ") lies inside '" + target.id + "'.", 'Attach the edge to the intended cell boundary or trim the free line with start_clearance/end_clearance; then correct z-order.', 'The arrow tip touches the intended boundary without entering an unrelated object, and the shaft remains outside its fill.');
            break;
          }
        }
      }
      for (const target of candidateVertices) {
        if (target === edge.source || target === edge.target) continue;
        if (edgeSemanticAncestor && edgeSemanticAncestor === semanticAncestor(target)) continue;
        const bounds = boundsFor(target);
        let intersects = false;
        for (let index = 1; index < route.length; index += 1) {
          if (segmentIntersectsRect(route[index - 1], route[index], bounds, Number(a.endpoint_clearance))) { intersects = true; break; }
        }
        if (intersects) addFinding('connector-path-through-object', 'hard', [edge.id, target.id], "The rendered route of '" + edge.id + "' passes through the interior of unrelated cell '" + target.id + "'.", 'Move the cell or reroute the edge with explicit entry/exit points and waypoints in a reserved connector lane.', 'No connector segment intersects an unrelated cell or label interior.');
      }
    }

    for (let firstIndex = 0; firstIndex < edges.length; firstIndex += 1) {
      const first = edges[firstIndex];
      const firstRoute = edgeRoutes.get(first.id) || [];
      if (firstRoute.length < 2) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < edges.length; secondIndex += 1) {
        const second = edges[secondIndex];
        if (first.source && (first.source === second.source || first.source === second.target)) continue;
        if (first.target && (first.target === second.source || first.target === second.target)) continue;
        const firstAncestor = semanticAncestor(first);
        if (firstAncestor && firstAncestor === semanticAncestor(second)) continue;
        const secondRoute = edgeRoutes.get(second.id) || [];
        let crossing = null;
        for (let firstSegment = 1; firstSegment < firstRoute.length && !crossing; firstSegment += 1) {
          for (let secondSegment = 1; secondSegment < secondRoute.length && !crossing; secondSegment += 1) {
            crossing = strictSegmentCrossing(firstRoute[firstSegment - 1], firstRoute[firstSegment], secondRoute[secondSegment - 1], secondRoute[secondSegment], Number(a.endpoint_clearance));
          }
        }
        if (crossing) addFinding('connector-crossing', 'hard', [first.id, second.id], 'Two unrelated connector routes cross near (' + Math.round(crossing.x * 100) / 100 + ',' + Math.round(crossing.y * 100) / 100 + ').', 'Assign separate routing lanes or move the affected nodes, then reroute the named edges.', 'Unrelated connector routes do not cross.');
      }
    }

    const seriesGroups = new Map();
    for (const cell of vertices) {
      const id = String(cell.id || '');
      const key = id.replace(/[-_]\\d+$/, '-*');
      if (key === id) continue;
      if (!seriesGroups.has(key)) seriesGroups.set(key, []);
      seriesGroups.get(key).push(cell);
    }
    for (const [key, group] of seriesGroups) {
      if (group.length < 3) continue;
      const items = group.map((cell) => ({ cell, bounds: boundsFor(cell) })).filter((item) => item.bounds);
      if (items.length < 3) continue;
      const centersX = items.map((item) => item.bounds.x + item.bounds.width / 2);
      const centersY = items.map((item) => item.bounds.y + item.bounds.height / 2);
      const rangeX = Math.max(...centersX) - Math.min(...centersX);
      const rangeY = Math.max(...centersY) - Math.min(...centersY);
      const verticalSeries = rangeY >= rangeX;
      const crossValues = items.map((item) => verticalSeries ? item.bounds.x : item.bounds.y);
      const crossSpread = Math.max(...crossValues) - Math.min(...crossValues);
      if (crossSpread > Number(a.alignment_tolerance)) addFinding('repeated-series-misalignment', 'hard', items.map((item) => item.cell.id), "Repeated series '" + key + "' has cross-axis spread " + Math.round(crossSpread * 100) / 100 + ', above the alignment tolerance.', 'Use drawio_live_align_cells on the repeated objects, preserving the planned outer bounds.', 'Cross-axis edges are equal within the alignment tolerance.');
      const ordered = items.sort((first, second) => verticalSeries ? first.bounds.y - second.bounds.y : first.bounds.x - second.bounds.x);
      const gaps = [];
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1].bounds;
        const current = ordered[index].bounds;
        gaps.push(verticalSeries ? current.y - (previous.y + previous.height) : current.x - (previous.x + previous.width));
      }
      if (gaps.length >= 2) {
        const spread = Math.max(...gaps) - Math.min(...gaps);
        if (spread > 2 * Number(a.alignment_tolerance)) addFinding('repeated-series-unequal-spacing', 'warning', ordered.map((item) => item.cell.id), "Repeated series '" + key + "' gap spread is " + Math.round(spread * 100) / 100 + '.', 'Use drawio_live_distribute_cells or exact coordinates after fixing the outer endpoints.', 'Repeated gaps differ by no more than twice the alignment tolerance.');
      }
    }

    const hardFailures = findings.filter((finding) => finding.severity === 'hard');
    const warnings = findings.filter((finding) => finding.severity === 'warning');
    const findingsTruncated = findings.length >= Number(a.max_findings);
    const pictures = vertices.filter(isPicture);
    return {
      backend: 'drawio',
      page_size: { width: pageWidth, height: pageHeight, visible: !!graph.pageVisible },
      object_counts: { total: allCells.length, vertices: vertices.length, edges: edges.length, pictures: pictures.length, native_or_composite: allCells.length - pictures.length },
      picture_audit: pictureAudits,
      hard_failure_count: hardFailures.length,
      warning_count: warnings.length,
      findings_truncated: findingsTruncated,
      passed: hardFailures.length === 0 && !findingsTruncated,
      findings,
      reviewer_contract: 'Every hard finding must be converted by the Corrector into named geometry, routing, text-fit, or decomposition operations, executed by the Drawer, rerendered, and audited again.',
    };
  `);
}

async function launchLive(args) {
  live.port = args.port || DEFAULT_PORT;
  live.stepDelayMs = args.step_delay_ms ?? 350;
  let target = null;
  try { target = await findTarget(live.port); } catch {}
  if (!target) {
    if (!(await canListen(live.port))) {
      if (args.port) throw new Error(`Port ${live.port} is already in use by a non-draw.io process.`);
      live.port = await findAvailablePort(live.port + 1);
    }
    const profileDir = process.env.DRAWIO_LIVE_PROFILE || path.join(PROFILE_ROOT, String(live.port));
    await fs.mkdir(profileDir, { recursive: true });
    const argv = [
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${live.port}`,
      `--user-data-dir=${profileDir}`,
      "--disable-features=CalculateNativeWinOcclusion",
    ];
    if (args.file_path) argv.push(path.resolve(args.file_path));
    live.process = spawn(DRAWIO.executable, argv, { detached: false, stdio: "ignore", windowsHide: false });
    await new Promise((resolve, reject) => {
      live.process.once("spawn", resolve);
      live.process.once("error", (error) => reject(new Error(`Unable to launch draw.io (${DRAWIO.executable}): ${error.message}. ${drawioInstallHint()}`)));
    });
    target = await waitForTarget(live.port);
  }
  await connectTarget(target);
  if (args.maximize !== false) {
    try {
      const result = await live.cdp.call("Browser.getWindowForTarget", { targetId: target.id });
      await live.cdp.call("Browser.setWindowBounds", { windowId: result.windowId, bounds: { windowState: "maximized" } });
    } catch {}
  }
  await sleep(1000);
  return { connected: true, port: live.port, drawio: DRAWIO, spawned_process_id: live.process?.pid || null, target: { id: target.id, title: target.title, url: target.url }, step_delay_ms: live.stepDelayMs, status: await liveStatus() };
}

async function bannerState() {
  return evaluate(`(() => {
    const alert = document.querySelector('.geStatusAlert[data-action="statusFunction"]')
      || document.querySelector('.geStatusAlert');
    const a = document.querySelector('a.geStatus');
    const text = ((alert && (alert.innerText || alert.title)) || (a && a.innerText) || '')
      .trim().replace(/\\s+/g, ' ').slice(0, 120);
    return {
      banner: !!alert,
      data_action: alert ? alert.getAttribute('data-action') : null,
      text: text || null,
    };
  })()`);
}

async function waitForFileChangedBanner(waitMs = 5000) {
  const deadline = Date.now() + Math.max(0, waitMs);
  let last = await bannerState();
  while (!last.banner && Date.now() < deadline) {
    await sleep(200);
    last = await bannerState();
  }
  return last;
}

async function triggerFileChangedSync() {
  // Preferred: menubar a.geStatus mxListener click (no OS mouse).
  const viaListener = await evaluate(`(() => {
    const alert = document.querySelector('.geStatusAlert[data-action="statusFunction"]')
      || document.querySelector('.geStatusAlert');
    const a = document.querySelector('a.geStatus');
    if (!alert && !a) return { ok: false, method: null, reason: 'no-banner' };
    const text = ((alert && (alert.innerText || alert.title)) || (a && a.innerText) || '')
      .trim().replace(/\\s+/g, ' ');
    if (text && !/измен|синхрон|changed|synchron/i.test(text)) {
      return { ok: false, method: null, reason: 'banner-text-mismatch', text: text.slice(0, 80) };
    }
    if (!a || !a.mxListenerList || !a.mxListenerList.length) {
      return { ok: false, method: null, reason: 'no-mxListener', text: text.slice(0, 80) };
    }
    try {
      const listener = a.mxListenerList.find((item) => item.name === 'click') || a.mxListenerList[0];
      listener.f.call(a, {
        type: listener.name || 'click',
        target: alert || a,
        currentTarget: a,
        bubbles: true,
      });
      return { ok: true, method: 'mxListener', evt: listener.name || 'click', text: text.slice(0, 100) };
    } catch (error) {
      return { ok: false, method: 'mxListener', reason: String(error), text: text.slice(0, 80) };
    }
  })()`);
  if (viaListener?.ok) return viaListener;

  // Fallback: synthetic DOM mouse events on the red plate (still no OS cursor).
  return evaluate(`(() => {
    const alert = document.querySelector('.geStatusAlert[data-action="statusFunction"]')
      || document.querySelector('.geStatusAlert');
    if (!alert) return { ok: false, method: null, reason: 'no-banner' };
    const text = (alert.innerText || alert.title || '').trim().replace(/\\s+/g, ' ');
    if (text && !/измен|синхрон|changed|synchron/i.test(text)) {
      return { ok: false, method: null, reason: 'banner-text-mismatch', text: text.slice(0, 80) };
    }
    const rect = alert.getBoundingClientRect();
    const x = rect.left + Math.min(120, Math.max(24, rect.width * 0.35));
    const y = rect.top + rect.height / 2;
    const el = document.elementFromPoint(x, y) || alert;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        button: 0,
      }));
    }
    return {
      ok: true,
      method: 'syntheticMouse',
      text: text.slice(0, 100),
      x,
      y,
      hit: String(el.className || ''),
    };
  })()`);
}

async function reloadFromDisk(args = {}) {
  const waitMs = args.wait_ms ?? 5000;
  const before = await waitForFileChangedBanner(waitMs);
  if (!before.banner) {
    return {
      ok: false,
      reason: "no-banner-within-wait",
      before,
      note: "Write the open .drawio on disk first; increase wait_ms if the Desktop watcher is slow. Prefer this tool over close/relaunch.",
    };
  }
  const attempt = await triggerFileChangedSync();
  await sleep(700);
  const after = await bannerState();
  const ok = Boolean(attempt?.ok) && !after.banner;
  return {
    ok,
    method: attempt?.ok ? attempt.method : null,
    reason: ok ? null : (attempt?.ok ? "banner-still-present-after-sync" : (attempt?.reason || "sync-failed")),
    before,
    attempt,
    after,
  };
}

async function handleTool(name, args = {}) {
  switch (name) {
    case "drawio_live_launch": {
      const result = await launchLive(args);
      return { value: result, imageData: args.include_screenshot === false ? undefined : await captureScreenshot() };
    }
    case "drawio_live_status":
      return { value: { connected: true, port: live.port, ...(await liveStatus()) } };
    case "drawio_live_get_capabilities":
      return { value: await getCapabilities(args) };
    case "drawio_live_screenshot":
      return { value: { ...(await liveStatus()), captured: true }, imageData: await captureScreenshot() };
    case "drawio_live_clear": {
      if (args.confirm !== true) throw new Error("confirm=true is required to clear the current page.");
      const value = await graphEval(`
        const parent = graph.getDefaultParent();
        const cells = graph.getChildCells(parent, true, true);
        graph.removeCells(cells, true);
        graph.clearSelection();
        return { removed: cells.length };
      `);
      await sleep(live.stepDelayMs);
      return { value };
    }
    case "drawio_live_add_shape":
      return { value: await addShape(args) };
    case "drawio_live_add_image":
      return { value: await addImage(args) };
    case "drawio_live_add_line":
      return { value: await addLine(args) };
    case "drawio_live_add_edge":
      return { value: await addEdge(args) };
    case "drawio_live_add_table":
      return { value: await addTable(args) };
    case "drawio_live_update_table_cell":
      return { value: await updateTableCell(args) };
    case "drawio_live_update_table_layout":
      return { value: await updateTableLayout(args) };
    case "drawio_live_add_chart":
      return { value: await addChart(args) };
    case "drawio_live_duplicate_cell":
      return { value: await duplicateCell(args) };
    case "drawio_live_group_cells":
      return { value: await groupCells(args) };
    case "drawio_live_ungroup_cell":
      return { value: await ungroupCell(args) };
    case "drawio_live_set_z_order":
      return { value: await setZOrder(args) };
    case "drawio_live_align_cells":
      return { value: await alignCells(args) };
    case "drawio_live_distribute_cells":
      return { value: await distributeCells(args) };
    case "drawio_live_update_cell":
      return { value: await updateCell(args) };
    case "drawio_live_fit":
      return { value: await fitView(args.zoom_percent), imageData: await captureScreenshot() };
    case "drawio_live_draw_sequence": {
      const delay = args.step_delay_ms ?? live.stepDelayMs;
      const results = [];
      for (let index = 0; index < args.operations.length; index += 1) {
        const operation = args.operations[index];
        const type = operation.type;
        if (type === "shape") results.push({ index, type, result: await addShape({ ...operation, pause_after_ms: delay }) });
        else if (type === "image") results.push({ index, type, result: await addImage({ ...operation, pause_after_ms: delay }) });
        else if (type === "line") results.push({ index, type, result: await addLine({ ...operation, pause_after_ms: delay }) });
        else if (type === "edge") results.push({ index, type, result: await addEdge({ ...operation, pause_after_ms: delay }) });
        else if (type === "table") results.push({ index, type, result: await addTable({ ...operation, pause_after_ms: delay }) });
        else if (type === "table_cell") results.push({ index, type, result: await updateTableCell({ ...operation, pause_after_ms: delay }) });
        else if (type === "table_layout") results.push({ index, type, result: await updateTableLayout({ ...operation, pause_after_ms: delay }) });
        else if (type === "chart") results.push({ index, type, result: await addChart({ ...operation, pause_after_ms: delay }) });
        else if (type === "duplicate") results.push({ index, type, result: await duplicateCell({ ...operation, pause_after_ms: delay }) });
        else if (type === "group") results.push({ index, type, result: await groupCells({ ...operation, pause_after_ms: delay }) });
        else if (type === "ungroup") results.push({ index, type, result: await ungroupCell({ ...operation, pause_after_ms: delay }) });
        else if (type === "z_order") results.push({ index, type, result: await setZOrder({ ...operation, pause_after_ms: delay }) });
        else if (type === "align") results.push({ index, type, result: await alignCells({ ...operation, pause_after_ms: delay }) });
        else if (type === "distribute") results.push({ index, type, result: await distributeCells({ ...operation, pause_after_ms: delay }) });
        else if (type === "update") results.push({ index, type, result: await updateCell({ ...operation, pause_after_ms: delay }) });
        else if (type === "fit") { results.push({ index, type, result: await fitView(operation.zoom_percent) }); await sleep(delay); }
        else if (type === "wait") { const ms = Math.max(0, Math.min(10000, operation.ms ?? delay)); await sleep(ms); results.push({ index, type, waited_ms: ms }); }
        else throw new Error(`Unsupported sequence operation at index ${index}: ${type}`);
      }
      return { value: { operations_applied: results.length, results }, imageData: args.screenshot_after === false ? undefined : await captureScreenshot() };
    }
    case "drawio_live_inspect": {
      const maxCells = args.max_cells || 500;
      const value = await graphEval(`
        const parent = graph.getDefaultParent();
        const cells = [];
        const visit = (container) => {
          for (let index = 0; index < container.getChildCount(); index += 1) {
            const child = container.getChildAt(index);
            if (child.vertex || child.edge) cells.push(child);
            if (child.getChildCount?.()) visit(child);
          }
        };
        visit(parent);
        const plain = cells.slice(0, ${maxCells}).map((cell) => ({
          id: cell.id,
          type: cell.vertex ? 'vertex' : cell.edge ? 'edge' : 'cell',
          parent_id: cell.parent?.id,
          label: graph.convertValueToString(cell),
          source: cell.source?.id,
          target: cell.target?.id,
          geometry: cell.geometry ? { x: cell.geometry.x, y: cell.geometry.y, width: cell.geometry.width, height: cell.geometry.height, relative: cell.geometry.relative, points: cell.geometry.points?.map((p) => ({ x: p.x, y: p.y })) } : null,
          style: cell.style || '',
          semantic_type: cell.value?.getAttribute?.('scientificIllustratorType') || '',
          raster_reason: cell.value?.getAttribute?.('scientificIllustratorRasterReason') || '',
          source_is_tightly_cropped: cell.value?.getAttribute?.('scientificIllustratorSourceTightlyCropped') || '',
          atomic_raster_unit: cell.value?.getAttribute?.('scientificIllustratorAtomicRasterUnit') || '',
          contains_reconstructable_content: cell.value?.getAttribute?.('scientificIllustratorContainsReconstructableContent') || '',
          decomposition_note: cell.value?.getAttribute?.('scientificIllustratorDecompositionNote') || '',
          start_clearance: cell.value?.getAttribute?.('scientificIllustratorStartClearance') || '',
          end_clearance: cell.value?.getAttribute?.('scientificIllustratorEndClearance') || '',
          requested_begin: {
            x: cell.value?.getAttribute?.('scientificIllustratorRequestedBeginX') || '',
            y: cell.value?.getAttribute?.('scientificIllustratorRequestedBeginY') || '',
          },
          requested_end: {
            x: cell.value?.getAttribute?.('scientificIllustratorRequestedEndX') || '',
            y: cell.value?.getAttribute?.('scientificIllustratorRequestedEndY') || '',
          },
          crop_percent: {
            left: Number(cell.value?.getAttribute?.('scientificIllustratorCropLeftPercent') || 0),
            top: Number(cell.value?.getAttribute?.('scientificIllustratorCropTopPercent') || 0),
            right: Number(cell.value?.getAttribute?.('scientificIllustratorCropRightPercent') || 0),
            bottom: Number(cell.value?.getAttribute?.('scientificIllustratorCropBottomPercent') || 0),
          },
          child_count: cell.getChildCount?.() || 0,
        }));
        return { cells: plain, total: cells.length, truncated: cells.length > ${maxCells}, zoom_percent: Math.round(graph.view.scale * 100) };
      `);
      return { value };
    }
    case "drawio_live_audit_figure":
      return { value: await auditFigure(args) };
    case "drawio_live_save_snapshot": {
      const output = path.resolve(args.output_path);
      if (path.extname(output).toLowerCase() !== ".drawio") throw new Error("output_path must end with .drawio");
      try {
        await fs.access(output);
        if (!args.overwrite) throw new Error(`Output exists; pass overwrite=true: ${output}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const modelXml = await graphEval(`
        const codec = new mxCodec();
        const node = codec.encode(graph.getModel());
        return mxUtils.getXml(node);
      `);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="Electron" modified="${new Date().toISOString()}" version="30.3.6">\n  <diagram id="live-page" name="${xmlEscape(args.page_name || "Live drawing")}">\n${modelXml}\n  </diagram>\n</mxfile>\n`;
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, xml, "utf8");
      return { value: { output_path: output, bytes: Buffer.byteLength(xml), saved_from_visible_session: true } };
    }
    case "drawio_live_reload_from_disk": {
      const value = await reloadFromDisk(args);
      if (!value.ok) return { value };
      return {
        value,
        imageData: args.include_screenshot ? await captureScreenshot() : undefined,
      };
    }
    case "drawio_live_close_session": {
      if (args.confirm !== true) throw new Error("confirm=true is required to close a draw.io session.");
      if (!live.process) throw new Error("This MCP server did not launch the connected draw.io process and will not close an external user session.");
      const spawnedProcess = live.process;
      const processId = spawnedProcess.pid;
      try { live.cdp?.ws?.close(); } catch {}
      const exited = new Promise((resolve) => spawnedProcess.once("exit", () => resolve(true)));
      const closed = spawnedProcess.kill();
      const exitedWithinTimeout = await Promise.race([exited, sleep(5000).then(() => false)]);
      live.process = null;
      live.cdp = null;
      live.target = null;
      return { value: { closed, exited: exitedWithinTimeout, process_id: processId, scope: "MCP-launched draw.io process only" } };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    const requested = params?.protocolVersion;
    return rpcResult(id, {
      protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "Control only draw.io's own graph API. Use the Designer -> Drawer -> Reviewer -> Corrector loop. Call drawio_live_get_capabilities before reconstruction, keep every reconstructable item editable, require every picture to be one atomic irreducible raster unit, and run drawio_live_audit_figure plus a renderer screenshot after each region and the whole canvas. Use exact alignment/distribution, table layout, text-fit, line-clearance, and routing tools before declaring a gate passed. Never use OS-level mouse, keyboard, or screen control. Save a .drawio snapshot only after live drawing.",
    });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools });
  if (method === "tools/call") {
    try {
      const result = await handleTool(params?.name, params?.arguments || {});
      return rpcResult(id, toolResult(result.value, { imageData: result.imageData }));
    } catch (error) {
      return rpcResult(id, toolResult({ error: error.message, tool: params?.name }, { isError: true }));
    }
  }
  if (method?.startsWith("notifications/")) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

async function processInputLine(line) {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); }
  catch (error) {
    process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "Parse error", error.message))}\n`);
    return;
  }
  try {
    const response = await handleMessage(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(rpcError(message.id, -32603, "Internal error", error.message))}\n`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let requestQueue = Promise.resolve();
rl.on("line", (line) => {
  requestQueue = requestQueue.then(() => processInputLine(line)).catch((error) => {
    process.stderr.write(`[${SERVER_NAME}] request queue error: ${error.stack || error.message}\n`);
  });
});

process.on("uncaughtException", (error) => process.stderr.write(`[${SERVER_NAME}] ${error.stack || error.message}\n`));
process.on("unhandledRejection", (error) => process.stderr.write(`[${SERVER_NAME}] ${error?.stack || error}\n`));
