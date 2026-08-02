#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getOfficeJsBridge } from "./officejs-bridge.mjs";

const execFileAsync = promisify(execFile);
const SERVER_NAME = "powerpoint-live";
const SERVER_VERSION = "1.6.0";
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = path.join(SCRIPT_DIR, "powerpoint-bridge.ps1");
const OOXML_BRIDGE_PATH = path.join(SCRIPT_DIR, "powerpoint-mac-bridge.py");
const OOXML_STATE_DIR = String(process.env.SCIENTIFIC_ILLUSTRATOR_STATE_DIR || process.env.SCIENTIFIC_ILLUSTRATOR_MAC_DIR || "").trim()
  || path.join(os.homedir(), ".codex", "scientific-illustrator", "presentations", "sessions", `${process.pid}-${Date.now().toString(36)}`);
const MAX_BUFFER = 20 * 1024 * 1024;
const officeJsBridge = getOfficeJsBridge();
const VALID_BACKENDS = new Set(["auto", "officejs", "com", "ooxml"]);
const VALID_FOCUS_POLICIES = new Set(["preserve", "foreground"]);
let backendPreference = VALID_BACKENDS.has(String(process.env.SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND || "auto").toLowerCase())
  ? String(process.env.SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND || "auto").toLowerCase()
  : "auto";
let focusPolicy = VALID_FOCUS_POLICIES.has(String(process.env.SCIENTIFIC_ILLUSTRATOR_FOCUS_POLICY || "preserve").toLowerCase())
  ? String(process.env.SCIENTIFIC_ILLUSTRATOR_FOCUS_POLICY || "preserve").toLowerCase()
  : "preserve";
let hostPreference = ["auto", "powerpoint", "wps"].includes(String(process.env.SCIENTIFIC_ILLUSTRATOR_PPT_HOST || "auto").toLowerCase())
  ? String(process.env.SCIENTIFIC_ILLUSTRATOR_PPT_HOST || "auto").toLowerCase()
  : "auto";
let lockedBackend = null;
let lockedHost = null;
let mutationCount = 0;

const positionProperties = {
  left: { type: "number", minimum: -100000, maximum: 100000, description: "Left position in points (72 points = 1 inch)." },
  top: { type: "number", minimum: -100000, maximum: 100000, description: "Top position in points." },
  width: { type: "number", exclusiveMinimum: 0, maximum: 100000, description: "Width in points." },
  height: { type: "number", exclusiveMinimum: 0, maximum: 100000, description: "Height in points." },
};

const textStyleProperties = {
  font_name: { type: "string" },
  font_size: { type: "number", minimum: 1, maximum: 400 },
  font_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
  bold: { type: "boolean" },
  italic: { type: "boolean" },
  alignment: { type: "string", enum: ["left", "center", "right", "justify"] },
  vertical_alignment: { type: "string", enum: ["top", "middle", "bottom"] },
};

const textFrameProperties = {
  margin_left: { type: "number", minimum: 0, maximum: 1000 },
  margin_right: { type: "number", minimum: 0, maximum: 1000 },
  margin_top: { type: "number", minimum: 0, maximum: 1000 },
  margin_bottom: { type: "number", minimum: 0, maximum: 1000 },
  word_wrap: { type: "boolean", default: true },
  text_autofit: { type: "string", enum: ["none", "shrink_text", "grow_shape"], default: "none" },
};

const lineStyleProperties = {
  line_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
  line_width: { type: "number", minimum: 0, maximum: 50 },
  line_transparency: { type: "number", minimum: 0, maximum: 100 },
  line_dash: {
    type: "string",
    enum: ["solid", "square_dot", "round_dot", "dash", "dash_dot", "long_dash", "long_dash_dot", "long_dash_dot_dot"],
  },
  start_arrow: { type: "string", enum: ["none", "open", "triangle", "stealth", "diamond", "oval"], default: "none" },
  end_arrow: { type: "string", enum: ["none", "open", "triangle", "stealth", "diamond", "oval"], default: "none" },
};

const shapeTargetProperties = {
  slide_index: { type: "integer", minimum: 1 },
  shape_name: { type: "string", description: "PowerPoint shape name. Prefer stable semantic names." },
  shape_id: { type: "integer", minimum: 1, description: "Numeric PowerPoint shape id." },
};

const tools = [
  {
    name: "powerpoint_status",
    description: "Check Microsoft PowerPoint or WPS Presentation availability and the current managed presentation. Windows PowerPoint prefers COM; Mac PowerPoint prefers a connected Office.js task pane with per-object context.sync; WPS and unconnected Mac PowerPoint use the editable OOXML fallback. This is read-only.",
    inputSchema: {
      type: "object",
      properties: {
        host_application: { type: "string", enum: ["auto", "powerpoint", "wps"], default: "auto" },
        wait_for_officejs_ms: { type: "integer", minimum: 0, maximum: 120000, default: 0, description: "Optionally wait for the PowerPoint task pane to connect before reporting the selected backend." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_officejs_status",
    description: "Start or inspect the loopback HTTPS bridge used by the PowerPoint Office.js task pane. Reports certificate, manifest, connection, API-set, and setup state without modifying a presentation.",
    inputSchema: {
      type: "object",
      properties: {
        wait_for_connection_ms: { type: "integer", minimum: 0, maximum: 120000, default: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_set_backend",
    description: "Select the presentation backend for this MCP session. Use officejs for visible context.sync drawing in the current PowerPoint deck, com for Windows PowerPoint, ooxml for the safe PPTX working copy, or auto for platform selection. A backend cannot be changed after drawing mutations begin.",
    inputSchema: {
      type: "object",
      required: ["backend"],
      properties: {
        backend: { type: "string", enum: ["auto", "officejs", "com", "ooxml"] },
        wait_for_connection_ms: { type: "integer", minimum: 0, maximum: 120000, default: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_set_focus_policy",
    description: "Choose whether ordinary PowerPoint/WPS drawing commands preserve the user's current foreground application or intentionally foreground the presentation window. The default preserve policy prevents repeated focus stealing; powerpoint_activate_slide remains an explicit foreground action.",
    inputSchema: {
      type: "object",
      required: ["focus_policy"],
      properties: {
        focus_policy: { type: "string", enum: ["preserve", "foreground"], description: "preserve keeps the user's current app focused; foreground retains legacy per-step presentation activation." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_get_capabilities",
    description: "Read the selected backend metadata and report which native or explicitly declared editable-composite object families, shapes, chart types, connectors, arrows, grouping, and layering operations are available. Also reports which capabilities this MCP exposes. This is read-only and never changes a deck.",
    inputSchema: {
      type: "object",
      properties: {
        include_auto_shapes: { type: "boolean", default: true, description: "Return the complete installed MsoAutoShapeType catalog with reusable names and numeric ids." },
        include_chart_types: { type: "boolean", default: true, description: "Return the installed native chart type catalog." },
        include_shape_types: { type: "boolean", default: true, description: "Return native PowerPoint shape-kind metadata used during inspection." },
        include_api_methods: { type: "boolean", default: false, description: "Return the raw installed Shapes/Shape COM method names for advanced planning." },
        host_application: { type: "string", enum: ["auto", "powerpoint", "wps"], default: "auto", description: "Choose Microsoft PowerPoint or WPS Presentation. Auto prefers Microsoft PowerPoint when available." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_launch",
    description: "Connect to or open a presentation in Microsoft PowerPoint or WPS Presentation. A connected Mac PowerPoint Office.js task pane controls the current deck live; opening a file path uses COM or the safe OOXML working-copy backend because Office.js cannot open desktop files.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Optional absolute path to an existing presentation. The editable OOXML PowerPoint/WPS backend accepts .pptx only; Windows COM may edit .pptm/.ppsx, while OOXML permits those formats only for read-only inspection." },
        create_if_missing: { type: "boolean", default: true, description: "Create a blank presentation only when no file and no active deck are available." },
        read_only: { type: "boolean", default: false },
        visible: { type: "boolean", default: true },
        maximize: { type: "boolean", default: true },
        host_application: { type: "string", enum: ["auto", "powerpoint", "wps"], default: "auto" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_new_presentation",
    description: "Create a separate blank presentation without repeatedly stealing focus under the default preserve policy. Use this to avoid modifying an already-open deck when starting new work.",
    inputSchema: {
      type: "object",
      properties: {
        maximize: { type: "boolean", default: true },
        host_application: { type: "string", enum: ["auto", "powerpoint", "wps"], default: "auto" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_inspect",
    description: "Inspect the active presentation, slide dimensions, and a compact inventory of slides and native shapes without changing the deck.",
    inputSchema: {
      type: "object",
      properties: {
        max_slides: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        max_shapes_per_slide: { type: "integer", minimum: 1, maximum: 1000, default: 200 },
        include_text: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_audit_figure",
    description: "Run a deterministic geometry, connector, text-fit, repeated-layout, and raster editability audit on one slide. Returns named hard failures and correction-oriented findings; it does not modify the presentation.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        alignment_tolerance: { type: "number", minimum: 0.05, maximum: 50, default: 0.75 },
        endpoint_clearance: { type: "number", minimum: 0, maximum: 100, default: 1.5 },
        text_overflow_tolerance: { type: "number", minimum: 0, maximum: 50, default: 1.5 },
        large_raster_area_ratio: { type: "number", minimum: 0.001, maximum: 1, default: 0.08 },
        max_findings: { type: "integer", minimum: 1, maximum: 2000, default: 300 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_activate_slide",
    description: "Explicitly bring the presentation forward and request one slide. File-backed WPS reports document-open verification separately because it cannot prove exact slide selection. Ordinary drawing preserves the foreground application by default.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      properties: { slide_index: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_refresh",
    description: "Flush the current editable OOXML working copy to the selected PowerPoint/WPS application. Reports dispatch, document-open, and reload verification separately and never labels an unverified WPS reload as successful.",
    inputSchema: {
      type: "object",
      properties: {
        focus_policy: { type: "string", enum: ["preserve", "foreground"], default: "preserve" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_slide",
    description: "Insert a native PowerPoint slide. With the default preserve focus policy, the edit occurs without foregrounding PowerPoint; use powerpoint_activate_slide only when a visible handoff is wanted.",
    inputSchema: {
      type: "object",
      properties: {
        position: { type: "integer", minimum: 1, description: "1-based insertion position; defaults to the end." },
        layout: { type: "string", enum: ["blank", "title", "text"], default: "blank" },
        name: { type: "string", description: "Optional semantic slide name." },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_textbox",
    description: "Add an editable native text box to a slide. Coordinates are PowerPoint points (72 points = 1 inch).",
    inputSchema: {
      type: "object",
      required: ["slide_index", "text", "left", "top", "width", "height"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        text: { type: "string" },
        ...positionProperties,
        ...textStyleProperties,
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        fill_transparency: { type: "number", minimum: 0, maximum: 100 },
        line_color: lineStyleProperties.line_color,
        line_width: lineStyleProperties.line_width,
        line_transparency: lineStyleProperties.line_transparency,
        line_dash: lineStyleProperties.line_dash,
        ...textFrameProperties,
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_shape",
    description: "Add any editable native PowerPoint AutoShape exposed by powerpoint_get_capabilities, using its plugin_name, Office enum name, or numeric shape_type_id.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "left", "top", "width", "height"],
      anyOf: [{ required: ["shape"] }, { required: ["shape_type_id"] }],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        shape: { type: "string", description: "Friendly plugin_name such as rectangle, flowchart_process, or left_right_arrow, or an Office enum name such as msoShapeRectangle." },
        shape_type_id: { type: "integer", minimum: 1, maximum: 10000, description: "Numeric MsoAutoShapeType id returned by powerpoint_get_capabilities." },
        text: { type: "string" },
        ...positionProperties,
        rotation: { type: "number", minimum: -360, maximum: 360 },
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        fill_transparency: { type: "number", minimum: 0, maximum: 100 },
        line_color: lineStyleProperties.line_color,
        line_width: lineStyleProperties.line_width,
        line_transparency: lineStyleProperties.line_transparency,
        line_dash: lineStyleProperties.line_dash,
        ...textStyleProperties,
        ...textFrameProperties,
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_image",
    description: "Insert a tightly scoped local raster or SVG asset as an editable PowerPoint picture object (a picture-filled shape in Office.js). A specific audit reason is mandatory; never use this for a whole panel containing text, boxes, arrows, tables, charts, labels, or other reconstructable native objects.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "image_path", "left", "top", "width", "height", "raster_reason", "source_is_tightly_cropped", "atomic_raster_unit", "contains_reconstructable_content", "decomposition_note"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        image_path: { type: "string", description: "Absolute path to a local image." },
        name: { type: "string" },
        ...positionProperties,
        lock_aspect_ratio: { type: "boolean", default: false },
        alt_text: { type: "string" },
        raster_reason: { type: "string", minLength: 8, description: "Why this exact visual region cannot be faithfully recreated with native editable PowerPoint objects, for example microscopy texture or a dense heatmap." },
        source_is_tightly_cropped: { type: "boolean", description: "True only when the source file already contains no reconstructable surrounding panel content. If false, at least one crop field is required." },
        atomic_raster_unit: { type: "boolean", const: true, description: "Must be true only when the picture contains exactly one irreducible raster field rather than a grid, montage, panel, comparison, or stack." },
        contains_reconstructable_content: { type: "boolean", const: false, description: "Must be false. Text, borders, arrows, legends, tables, axes, and regular plots must be rebuilt as native objects outside this picture." },
        decomposition_note: { type: "string", minLength: 8, description: "What was separated from the source crop and rebuilt natively, or why no further semantic split is possible." },
        crop_left_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_top_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_right_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_bottom_percent: { type: "number", minimum: 0, maximum: 99 },
        crop_left_points: { type: "number", minimum: 0, maximum: 100000 },
        crop_top_points: { type: "number", minimum: 0, maximum: 100000 },
        crop_right_points: { type: "number", minimum: 0, maximum: 100000 },
        crop_bottom_points: { type: "number", minimum: 0, maximum: 100000 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_line",
    description: "Add an editable native PowerPoint line or arrow between explicit slide coordinates. Use this for free arrows, separators, axes, ticks, and annotations that should not be attached to two shapes.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "begin_x", "begin_y", "end_x", "end_y"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        begin_x: { type: "number", minimum: -100000, maximum: 100000 },
        begin_y: { type: "number", minimum: -100000, maximum: 100000 },
        end_x: { type: "number", minimum: -100000, maximum: 100000 },
        end_y: { type: "number", minimum: -100000, maximum: 100000 },
        start_clearance: { type: "number", minimum: 0, maximum: 10000, default: 0, description: "Trim this many points from the beginning of the line." },
        end_clearance: { type: "number", minimum: 0, maximum: 10000, default: 0, description: "Trim this many points from the end so the arrowhead does not intrude into a target object." },
        ...lineStyleProperties,
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_connector",
    description: "Connect two named shapes. COM/OOXML use a PowerPoint connector that stays attached when shapes move; Office.js uses a named editable geometry-backed route because that API exposes no connection-site binding, and reports this limitation.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "source_name", "target_name"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        source_name: { type: "string" },
        target_name: { type: "string" },
        source_site: { type: "integer", minimum: 1, description: "Optional connection-site index. The OOXML backend chooses the nearest top/right/bottom/left side when omitted." },
        target_site: { type: "integer", minimum: 1, description: "Optional connection-site index. The OOXML backend chooses the nearest top/right/bottom/left side when omitted." },
        connector_type: { type: "string", enum: ["straight", "elbow", "curve"], default: "elbow" },
        ...lineStyleProperties,
        end_arrow: { type: "string", enum: ["none", "open", "triangle", "stealth", "diamond", "oval"], default: "triangle" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_table",
    description: "Add a native editable PowerPoint table. Text, fills, borders, header styling, banding, and per-cell overrides remain editable and must be preferred over rasterized tables.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "rows", "columns", "left", "top", "width", "height"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        rows: { type: "integer", minimum: 1, maximum: 200 },
        columns: { type: "integer", minimum: 1, maximum: 100 },
        data: {
          type: "array",
          maxItems: 200,
          items: { type: "array", maxItems: 100, items: { type: ["string", "number", "boolean", "null"] } },
        },
        ...positionProperties,
        ...textStyleProperties,
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        fill_transparency: { type: "number", minimum: 0, maximum: 100 },
        header_rows: { type: "integer", minimum: 0, maximum: 20, default: 1 },
        header_fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        header_font_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        header_bold: { type: "boolean", default: true },
        banded_rows: { type: "boolean", default: false },
        band_fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        border_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        border_width: { type: "number", minimum: 0, maximum: 20 },
        cell_margin: { type: "number", minimum: 0, maximum: 100 },
        cell_styles: {
          type: "array",
          maxItems: 1000,
          items: {
            type: "object",
            required: ["row", "column"],
            properties: {
              row: { type: "integer", minimum: 1 },
              column: { type: "integer", minimum: 1 },
              text: { type: "string" },
              ...textStyleProperties,
              fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
              fill_transparency: { type: "number", minimum: 0, maximum: 100 },
              border_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
              border_width: { type: "number", minimum: 0, maximum: 20 },
            },
            additionalProperties: false,
          },
        },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_update_table_cell",
    description: "Update one cell in an existing native PowerPoint table without replacing the table or rasterizing it.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "row", "column"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        row: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
        text: { type: "string" },
        ...textStyleProperties,
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        fill_transparency: { type: "number", minimum: 0, maximum: 100 },
        border_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        border_width: { type: "number", minimum: 0, maximum: 20 },
        cell_margin: { type: "number", minimum: 0, maximum: 100 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_update_table_layout",
    description: "Set exact native PowerPoint table column widths and row heights so method columns, numeric columns, and compact scientific tables remain aligned and readable.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        column_widths: { type: "array", minItems: 1, maxItems: 100, items: { type: "number", exclusiveMinimum: 0, maximum: 100000 } },
        row_heights: { type: "array", minItems: 1, maxItems: 200, items: { type: "number", exclusiveMinimum: 0, maximum: 100000 } },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_add_chart",
    description: "Add an editable regular chart. COM/OOXML create a native PowerPoint chart backed by embedded data; Office.js creates a named editable shape composite because the PowerPoint JavaScript API exposes no chart insertion. Never screenshot a reconstructable regular plot.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "left", "top", "width", "height", "categories", "series"],
      anyOf: [{ required: ["chart_type"] }, { required: ["chart_type_id"] }],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        name: { type: "string" },
        chart_type: { type: "string", description: "Friendly plugin_name or Office XlChartType enum name returned by powerpoint_get_capabilities." },
        chart_type_id: { type: "integer", minimum: -10000, maximum: 10000 },
        categories: { type: "array", minItems: 1, maxItems: 1000, items: { type: ["string", "number"] } },
        series: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            required: ["name", "values"],
            properties: {
              name: { type: "string" },
              values: { type: "array", minItems: 1, maxItems: 1000, items: { type: "number" } },
            },
            additionalProperties: false,
          },
        },
        ...positionProperties,
        title: { type: "string" },
        has_legend: { type: "boolean", default: true },
        legend_position: { type: "string", enum: ["right", "left", "top", "bottom"], default: "right" },
        chart_style: { type: "integer", minimum: 1, maximum: 48 },
        category_axis_title: { type: "string" },
        value_axis_title: { type: "string" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_duplicate_shape",
    description: "Duplicate an editable PowerPoint object and give it a stable semantic name. COM duplicates native objects; OOXML remaps nested shape and connector ids but requires native charts to be recreated from their series so data parts are not shared; Office.js reconstructs tagged text/geometric shapes and rejects unsupported families explicitly.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "new_name"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        new_name: { type: "string", minLength: 1 },
        ...positionProperties,
        rotation: { type: "number", minimum: -360, maximum: 360 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_group_shapes",
    description: "Group two or more named native PowerPoint objects while preserving editability of the group members.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "shape_names"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        shape_names: { type: "array", minItems: 2, maxItems: 500, uniqueItems: true, items: { type: "string", minLength: 1 } },
        name: { type: "string" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_ungroup_shape",
    description: "Ungroup one native PowerPoint group and return the editable member inventory.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: { ...shapeTargetProperties, pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 } },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_set_z_order",
    description: "Move a native PowerPoint object forward, backward, to the front, or to the back without flattening the slide.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "command"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        command: { type: "string", enum: ["bring_to_front", "send_to_back", "bring_forward", "send_backward"] },
        repeat: { type: "integer", minimum: 1, maximum: 1000, default: 1 },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_align_shapes",
    description: "Align two or more named native objects to an exact shared edge or center using PowerPoint's layout engine.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "shape_names", "alignment"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        shape_names: { type: "array", minItems: 2, maxItems: 500, uniqueItems: true, items: { type: "string", minLength: 1 } },
        alignment: { type: "string", enum: ["left", "center", "right", "top", "middle", "bottom"] },
        relative_to: { type: "string", enum: ["selection", "slide"], default: "selection" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_distribute_shapes",
    description: "Distribute three or more named native objects with equal horizontal or vertical spacing using PowerPoint's layout engine.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "shape_names", "direction"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        shape_names: { type: "array", minItems: 3, maxItems: 500, uniqueItems: true, items: { type: "string", minLength: 1 } },
        direction: { type: "string", enum: ["horizontal", "vertical"] },
        relative_to: { type: "string", enum: ["selection", "slide"], default: "selection" },
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_update_shape",
    description: "Update an existing native shape by stable name or numeric id while preserving the rest of the slide.",
    inputSchema: {
      type: "object",
      required: ["slide_index"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: {
        ...shapeTargetProperties,
        new_name: { type: "string" },
        text: { type: "string" },
        ...positionProperties,
        rotation: { type: "number", minimum: -360, maximum: 360 },
        fill_color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
        fill_transparency: { type: "number", minimum: 0, maximum: 100 },
        ...lineStyleProperties,
        ...textStyleProperties,
        ...textFrameProperties,
        pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_delete_shape",
    description: "Delete one native PowerPoint shape. Requires confirm=true because this changes the active deck.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "confirm"],
      anyOf: [{ required: ["shape_name"] }, { required: ["shape_id"] }],
      properties: { ...shapeTargetProperties, confirm: { const: true }, pause_after_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 } },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_draw_sequence",
    description: "Apply a paced sequence of native slide, text, shape, line, connector, table, chart, image, grouping, layering, and update operations. Office.js acknowledges every context.sync; file-backed PowerPoint/WPS saves every operation but refreshes the application only at checkpoints by default.",
    inputSchema: {
      type: "object",
      required: ["operations"],
      properties: {
        host_application: { type: "string", enum: ["auto", "powerpoint", "wps"], default: "auto", description: "Target application for every operation in the sequence. Set wps explicitly when testing or drawing in WPS Presentation." },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: {
            type: "object",
            required: ["type"],
            properties: { type: { type: "string", enum: ["add_slide", "add_textbox", "add_shape", "add_image", "add_line", "add_connector", "add_table", "update_table_cell", "update_table_layout", "add_chart", "duplicate_shape", "group_shapes", "ungroup_shape", "set_z_order", "align_shapes", "distribute_shapes", "update_shape", "activate_slide", "wait"] } },
            additionalProperties: true,
          },
        },
        step_delay_ms: { type: "integer", minimum: 0, maximum: 10000, default: 350 },
        pacing_mode: { type: "string", enum: ["per_object", "checkpoint", "fast"], default: "checkpoint", description: "Office.js always awaits every context.sync. For file-backed WPS/PowerPoint, per_object refreshes after every object, checkpoint refreshes at checkpoint_size boundaries, and fast refreshes once at the end." },
        checkpoint_size: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_export_slide_image",
    description: "Export one slide through PowerPoint's renderer to PNG or JPG and return it for visual inspection.",
    inputSchema: {
      type: "object",
      required: ["slide_index", "output_path"],
      properties: {
        slide_index: { type: "integer", minimum: 1 },
        output_path: { type: "string", description: "Absolute .png/.jpg output path." },
        width: { type: "integer", minimum: 100, maximum: 10000, default: 1920 },
        height: { type: "integer", minimum: 100, maximum: 10000, default: 1080 },
        preserve_aspect_ratio: { type: "boolean", default: true, description: "Fit inside width/height without stretching. If height is omitted, derive it from the slide aspect ratio." },
        overwrite: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_save",
    description: "Save the active deck, save an editable .pptx copy, or export a PDF. Existing output files require overwrite=true.",
    inputSchema: {
      type: "object",
      properties: {
        output_path: { type: "string", description: "Optional absolute .pptx or .pdf path. Without it, saves the active presentation in place." },
        format: { type: "string", enum: ["pptx", "pdf"], description: "Defaults from output_path extension." },
        overwrite: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_close_presentation",
    description: "Close only the active presentation, either saving or discarding its unsaved changes. Requires confirm=true; use carefully when other user decks are open.",
    inputSchema: {
      type: "object",
      required: ["confirm"],
      properties: {
        confirm: { const: true },
        save_changes: { type: "string", enum: ["discard", "save"], default: "discard" },
        output_path: { type: "string", description: "Optional absolute .pptx path used when save_changes=save and the deck has no file path." },
        overwrite: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "powerpoint_quit_application",
    description: "Quit PowerPoint only when it has zero open presentations. Requires confirm=true and the exact active application process id reported by powerpoint_status, preventing accidental closure of a user application instance.",
    inputSchema: {
      type: "object",
      required: ["confirm", "expected_process_id"],
      properties: {
        confirm: { const: true },
        expected_process_id: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
];

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function toolResult(value, { isError = false, imageData, mimeType = "image/png" } = {}) {
  const content = [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
  if (imageData) content.push({ type: "image", data: imageData, mimeType });
  return {
    content,
    ...(typeof value === "object" && value !== null ? { structuredContent: value } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

function powershellExecutable() {
  if (process.env.POWERSHELL_PATH?.trim()) return process.env.POWERSHELL_PATH.trim();
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  const candidate = systemRoot && path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return candidate && existsSync(candidate) ? candidate : "powershell.exe";
}

let cachedOoxmlPython;

async function ooxmlPythonExecutable() {
  if (cachedOoxmlPython) return cachedOoxmlPython;
  const candidates = [
    { executable: process.env.SCIENTIFIC_ILLUSTRATOR_PYTHON, args: [] },
    { executable: path.join(SCRIPT_DIR, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python3"), args: [] },
    {
      executable: process.platform === "win32"
        ? path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe")
        : path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "bin", "python3"),
      args: [],
    },
    {
      executable: process.platform === "win32"
        ? path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "bin", "python.exe")
        : null,
      args: [],
    },
    { executable: process.platform === "win32" ? "python.exe" : "python3", args: [] },
    { executable: process.platform === "win32" ? "py.exe" : "/opt/homebrew/bin/python3", args: process.platform === "win32" ? ["-3"] : [] },
    { executable: process.platform === "win32" ? null : "/usr/local/bin/python3", args: [] },
  ].filter((candidate) => candidate.executable);
  const failures = [];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.executable, [...candidate.args, "-c", "import pptx; print(pptx.__version__)"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
      cachedOoxmlPython = candidate;
      return candidate;
    } catch (error) {
      failures.push(`${candidate.executable}${candidate.args.length ? ` ${candidate.args.join(" ")}` : ""}: ${String(error.message || error).split("\n")[0]}`);
    }
  }
  throw new Error(`The PowerPoint/WPS OOXML backend requires Python with python-pptx. Run install.sh on macOS/Linux or set SCIENTIFIC_ILLUSTRATOR_PYTHON. Checked: ${failures.join("; ")}`);
}

async function runOoxmlBridge(action, args = {}) {
  if (!existsSync(OOXML_BRIDGE_PATH)) throw new Error(`OOXML presentation bridge is missing: ${OOXML_BRIDGE_PATH}`);
  const payload = Buffer.from(JSON.stringify({ action, arguments: args }), "utf8").toString("base64");
  const launcher = await ooxmlPythonExecutable();
  try {
    const { stdout } = await execFileAsync(launcher.executable, [...launcher.args, OOXML_BRIDGE_PATH, payload], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      env: {
        ...process.env,
        SCIENTIFIC_ILLUSTRATOR_STATE_DIR: OOXML_STATE_DIR,
        SCIENTIFIC_ILLUSTRATOR_FOCUS_POLICY: String(args.focus_policy || focusPolicy),
        SCIENTIFIC_ILLUSTRATOR_DEFER_REFRESH: args.defer_refresh === true ? "1" : "0",
      },
    });
    const text = stdout.trim();
    if (!text) throw new Error("PowerPoint/WPS OOXML bridge returned no JSON.");
    return JSON.parse(text);
  } catch (error) {
    const details = String(error.stderr || error.stdout || error.message || error).trim();
    throw new Error(details || "PowerPoint/WPS OOXML bridge failed.");
  }
}

let cachedWindowsPowerPointAvailable;

async function windowsPowerPointAvailable() {
  if (cachedWindowsPowerPointAvailable !== undefined) return cachedWindowsPowerPointAvailable;
  if (process.platform !== "win32") return false;
  try {
    await execFileAsync("reg.exe", ["query", "HKCR\\PowerPoint.Application\\CLSID"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
    cachedWindowsPowerPointAvailable = true;
  } catch {
    cachedWindowsPowerPointAvailable = false;
  }
  return cachedWindowsPowerPointAvailable;
}

const MUTATING_ACTIONS = new Set([
  "add_slide", "add_textbox", "add_shape", "add_image", "add_line", "add_connector", "add_table",
  "update_table_cell", "update_table_layout", "add_chart", "duplicate_shape", "group_shapes", "ungroup_shape",
  "set_z_order", "align_shapes", "distribute_shapes", "update_shape", "delete_shape", "activate_slide",
]);
const BACKEND_LOCKING_ACTIONS = new Set([...MUTATING_ACTIONS, "launch", "new_presentation", "save", "close_presentation", "quit_application"]);

function requestedHost(args = {}) {
  const host = String(args.host_application || hostPreference || "auto").trim().toLowerCase();
  if (!["auto", "powerpoint", "wps"].includes(host)) throw new Error(`Unknown host_application: ${host}`);
  return host;
}

async function officeJsStatus(waitForConnectionMs = 0) {
  try {
    await officeJsBridge.start();
    return await officeJsBridge.waitForClient(waitForConnectionMs);
  } catch (error) {
    return { ...officeJsBridge.status(), connected: false, last_error: error.message };
  }
}

function officeJsImageMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

async function prepareOfficeJsArguments(action, args) {
  const prepared = { ...args };
  if (action === "add_image") {
    const source = path.resolve(String(args.image_path || ""));
    if (!path.isAbsolute(String(args.image_path || ""))) throw new Error("powerpoint_add_image requires an absolute image_path.");
    if (!existsSync(source)) throw new Error(`Image file not found: ${source}`);
    const cropRequested = ["crop_left_percent", "crop_top_percent", "crop_right_percent", "crop_bottom_percent", "crop_left_points", "crop_top_points", "crop_right_points", "crop_bottom_points"].some((key) => args[key] !== undefined);
    if (args.source_is_tightly_cropped !== true || cropRequested) {
      throw new Error("The Office.js live backend requires a pre-cropped atomic source image because PowerPoint ShapeFill.setImage does not expose crop controls. Crop the minimal visual field first and call powerpoint_add_image with source_is_tightly_cropped=true, or use the OOXML backend for PowerPoint crop properties.");
    }
    prepared.image_base64 = await fs.readFile(source, { encoding: "base64" });
    prepared.image_mime_type = officeJsImageMime(source);
  }
  return prepared;
}

async function writeOfficeJsOutput(action, args, result) {
  if (action === "export_slide_image") {
    const outputPath = String(args.output_path || "");
    if (!path.isAbsolute(outputPath)) throw new Error("powerpoint_export_slide_image requires an absolute output_path.");
    if (existsSync(outputPath) && args.overwrite !== true) throw new Error(`Output exists: ${outputPath}`);
    if (!result.image_base64) throw new Error("Office.js renderer returned no image data.");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(result.image_base64, "base64"));
    const value = { ...result, output_path: outputPath };
    delete value.image_base64;
    return value;
  }
  if (action === "save" && args.output_path) {
    const outputPath = String(args.output_path);
    if (!path.isAbsolute(outputPath)) throw new Error("powerpoint_save requires an absolute output_path.");
    if (existsSync(outputPath) && args.overwrite !== true) throw new Error(`Output exists: ${outputPath}`);
    if (!result.file_base64) throw new Error("Office.js editable presentation export returned no PPTX data.");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(result.file_base64, "base64"));
    const value = { ...result, output_path: outputPath, saved: true };
    delete value.file_base64;
    return value;
  }
  return result;
}

async function runOfficeJsBridge(action, args = {}) {
  const prepared = await prepareOfficeJsArguments(action, args);
  const result = await officeJsBridge.dispatch(action, prepared, {
    waitForClientMs: Number(args.wait_for_officejs_ms || 0),
    timeoutMs: ["save", "export_slide_image"].includes(action) ? 180000 : 60000,
  });
  return writeOfficeJsOutput(action, args, result);
}

async function runComBridge(action, args = {}) {
  if (process.platform !== "win32") throw new Error("The PowerPoint COM backend is available only on Windows with desktop Microsoft PowerPoint.");
  const payload = Buffer.from(JSON.stringify({ action, arguments: args }), "utf8").toString("base64");
  try {
    const { stdout } = await execFileAsync(
      powershellExecutable(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", BRIDGE_PATH, "-PayloadBase64", payload],
      { encoding: "utf8", windowsHide: true, maxBuffer: MAX_BUFFER },
    );
    const text = stdout.trim();
    if (!text) throw new Error("PowerPoint bridge returned no JSON.");
    return JSON.parse(text);
  } catch (error) {
    const details = String(error.stderr || error.stdout || error.message || error).trim();
    throw new Error(details || "PowerPoint bridge failed.");
  }
}

async function resolveBackend(action, args = {}) {
  const host = requestedHost(args);
  if (lockedBackend) {
    if (host !== "auto" && lockedHost && host !== lockedHost) {
      throw new Error(`This presentation session is locked to ${lockedHost} through ${lockedBackend}, but ${host} was requested. Start a new Codex task before switching target applications.`);
    }
    if (host === "wps" && lockedBackend !== "ooxml") {
      throw new Error(`This presentation session is locked to ${lockedBackend}, which cannot control WPS Presentation. Start a new Codex task and select host_application=wps before editing.`);
    }
    if (args.host_application !== undefined) hostPreference = host;
    return lockedBackend;
  }
  if (args.host_application !== undefined) hostPreference = host;
  if (host === "wps") {
    if (backendPreference === "officejs" || backendPreference === "com") throw new Error(`Backend ${backendPreference} cannot control WPS Presentation. Select ooxml or auto.`);
    return "ooxml";
  }
  if (backendPreference === "officejs") {
    const status = await officeJsStatus(Number(args.wait_for_officejs_ms || args.wait_for_connection_ms || 0));
    if (!status.connected) throw new Error("Office.js was selected but its PowerPoint task pane is not connected. Prepare and trust the localhost certificate, sideload officejs/manifest.xml, open Scientific Illustrator Live in the current deck, and retry.");
    return "officejs";
  }
  if (backendPreference === "com") {
    if (!(await windowsPowerPointAvailable())) throw new Error("PowerPoint COM was selected but desktop Microsoft PowerPoint is not registered on Windows.");
    return "com";
  }
  if (backendPreference === "ooxml") return "ooxml";
  if (process.platform === "win32" && await windowsPowerPointAvailable()) return "com";
  if (action === "new_presentation" || (action === "launch" && args.file_path)) return "ooxml";
  if (process.platform === "darwin" || process.platform === "win32") {
    const status = await officeJsStatus(Number(args.wait_for_officejs_ms || 0));
    if (status.connected) return "officejs";
  }
  return "ooxml";
}

async function runBridge(action, args = {}, forcedBackend = null) {
  const effectiveArgs = { ...args, focus_policy: args.focus_policy || focusPolicy };
  let requested = requestedHost(effectiveArgs);
  if (effectiveArgs.host_application === undefined && requested !== "auto") effectiveArgs.host_application = requested;
  const resolvedBackend = await resolveBackend(action, effectiveArgs);
  if (forcedBackend && forcedBackend !== resolvedBackend) {
    throw new Error(`Sequence backend ${forcedBackend} cannot satisfy the requested ${resolvedBackend} route. Start a new task with one target application and backend.`);
  }
  const backend = forcedBackend || resolvedBackend;
  if (requested === "wps" && backend !== "ooxml") throw new Error(`Backend ${backend} cannot control WPS Presentation.`);

  // An OOXML mutation requested with host=auto still needs a concrete target
  // before the first byte is written. Otherwise a later explicit WPS request
  // could reuse a working copy that was silently created for PowerPoint.
  if (backend === "ooxml" && requested === "auto" && !lockedHost && BACKEND_LOCKING_ACTIONS.has(action)) {
    const preflight = await runOoxmlBridge("status", effectiveArgs);
    const detectedHost = String(preflight?.target_application || preflight?.host_application || "").trim().toLowerCase();
    if (!new Set(["powerpoint", "wps"]).has(detectedHost)) {
      throw new Error("The OOXML backend could not resolve host_application=auto to PowerPoint or WPS before mutation.");
    }
    requested = detectedHost;
    effectiveArgs.host_application = detectedHost;
  }
  if (effectiveArgs.host_application !== undefined) hostPreference = requested;
  let value;
  if (backend === "officejs") value = await runOfficeJsBridge(action, effectiveArgs);
  else if (backend === "com") value = await runComBridge(action, effectiveArgs);
  else value = await runOoxmlBridge(action, effectiveArgs);
  if (BACKEND_LOCKING_ACTIONS.has(action)) {
    lockedBackend = backend;
    const reportedHost = String(value?.target_application || value?.host_application || "").trim().toLowerCase();
    const selectedHost = reportedHost === "wps" || reportedHost === "powerpoint"
      ? reportedHost
      : backend === "com" || backend === "officejs"
        ? "powerpoint"
        : requested === "auto" ? null : requested;
    if (lockedHost && selectedHost && lockedHost !== selectedHost) {
      throw new Error(`Backend response targeted ${selectedHost}, but this session is locked to ${lockedHost}. Start a new Codex task; no further edits will be dispatched.`);
    }
    lockedHost = lockedHost || selectedHost;
  }
  if (MUTATING_ACTIONS.has(action)) mutationCount += 1;
  if (value && typeof value === "object") {
    value.focus_policy = focusPolicy;
    value.backend_selection = {
      selected: backend,
      preference: backendPreference,
      locked: lockedBackend,
      locked_host: lockedHost,
      host_preference: hostPreference,
      mutation_count: mutationCount,
    };
    if (action === "status" || action === "capabilities") {
      value.officejs_live = await officeJsStatus(0);
    }
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSequence(args) {
  const actionMap = {
    add_slide: "add_slide",
    add_textbox: "add_textbox",
    add_shape: "add_shape",
    add_image: "add_image",
    add_line: "add_line",
    add_connector: "add_connector",
    add_table: "add_table",
    update_table_cell: "update_table_cell",
    update_table_layout: "update_table_layout",
    add_chart: "add_chart",
    duplicate_shape: "duplicate_shape",
    group_shapes: "group_shapes",
    ungroup_shape: "ungroup_shape",
    set_z_order: "set_z_order",
    align_shapes: "align_shapes",
    distribute_shapes: "distribute_shapes",
    update_shape: "update_shape",
    activate_slide: "activate_slide",
  };
  const requestedDelay = args.step_delay_ms ?? 350;
  const pacingMode = args.pacing_mode || "checkpoint";
  const checkpointSize = args.checkpoint_size || 10;
  const sequenceHost = requestedHost(args);
  const sequenceBackend = await resolveBackend("status", args);
  const results = [];
  const fileRefreshes = [];
  let pendingFileRefresh = false;
  let appliedObjects = 0;

  const flushFileRefresh = async (reason) => {
    if (sequenceBackend !== "ooxml" || !pendingFileRefresh) return;
    const result = await runBridge("refresh", { focus_policy: focusPolicy, host_application: lockedHost || args.host_application });
    fileRefreshes.push({ reason, after_operation_count: appliedObjects, result });
    pendingFileRefresh = false;
  };

  try {
    for (let index = 0; index < args.operations.length; index += 1) {
      const operation = { ...args.operations[index] };
      const type = operation.type;
      delete operation.type;
      if (type === "wait") {
        if (pacingMode !== "fast") await flushFileRefresh("before_wait");
        const waitMs = Math.max(0, Math.min(10000, operation.ms ?? requestedDelay));
        await sleep(waitMs);
        results.push({ index, type, waited_ms: waitMs });
        continue;
      }
      const action = actionMap[type];
      if (!action) throw new Error(`Unsupported sequence operation at index ${index}: ${type}`);
      if (operation.host_application !== undefined) {
        const operationHost = requestedHost(operation);
        const requiredHost = lockedHost || (sequenceHost === "auto" ? null : sequenceHost);
        if (requiredHost && operationHost !== "auto" && operationHost !== requiredHost) {
          throw new Error(`Sequence operation ${index} requests ${operationHost}, but the sequence target is ${requiredHost}. No object was dispatched for this operation.`);
        }
      }
      operation.pause_after_ms = 0;
      if (operation.host_application === undefined) {
        const inheritedHost = lockedHost || (sequenceHost === "auto" ? null : sequenceHost);
        if (inheritedHost) operation.host_application = inheritedHost;
      }
      if (sequenceBackend === "ooxml" && action !== "activate_slide") operation.defer_refresh = true;
      results.push({ index, type, result: await runBridge(action, operation, sequenceBackend) });
      appliedObjects += 1;
      if (sequenceBackend === "ooxml") {
        if (action === "activate_slide") {
          pendingFileRefresh = false;
        } else {
          pendingFileRefresh = true;
          const checkpointReached = pacingMode === "per_object" || (pacingMode === "checkpoint" && appliedObjects % checkpointSize === 0);
          if (checkpointReached) await flushFileRefresh(pacingMode === "per_object" ? "per_object" : "checkpoint");
        }
      }
      const shouldDelay = pacingMode === "per_object" || (pacingMode === "checkpoint" && appliedObjects % checkpointSize === 0);
      const delay = pacingMode === "fast" || !shouldDelay ? 0 : requestedDelay;
      if (delay > 0) await sleep(delay);
    }
    await flushFileRefresh("sequence_end");
  } catch (error) {
    try {
      await flushFileRefresh("error_recovery");
    } catch (refreshError) {
      error.message = `${error.message}; final OOXML refresh also failed: ${refreshError.message}`;
    }
    throw error;
  }
  return {
    operations_applied: results.length,
    object_operations_applied: appliedObjects,
    backend: sequenceBackend,
    target_application: lockedHost,
    pacing_mode: pacingMode,
    step_delay_ms: requestedDelay,
    checkpoint_size: checkpointSize,
    context_sync_acknowledged_per_operation: sequenceBackend === "officejs",
    file_refresh_strategy: sequenceBackend === "ooxml" ? pacingMode : "not-applicable",
    file_refresh_count: fileRefreshes.length,
    file_refreshes: fileRefreshes,
    results,
  };
}

async function handleTool(name, args = {}) {
  if (name === "powerpoint_draw_sequence") return { value: await runSequence(args) };
  if (name === "powerpoint_officejs_status") {
    const value = await officeJsStatus(Number(args.wait_for_connection_ms || 0));
    value.setup = {
      prepare_command: "node plugins/scientific-illustrator/scripts/officejs-setup.mjs prepare",
      mac_sideload_command: "node plugins/scientific-illustrator/scripts/officejs-setup.mjs sideload",
      certificate_trust_is_manual: true,
      manifest_path: path.resolve(SCRIPT_DIR, "..", "officejs", "manifest.xml"),
    };
    return { value };
  }
  if (name === "powerpoint_set_backend") {
    const requested = String(args.backend || "auto").toLowerCase();
    if (!VALID_BACKENDS.has(requested)) throw new Error(`Unknown backend: ${requested}`);
    if (lockedBackend && requested !== lockedBackend && requested !== backendPreference) {
      throw new Error(`This presentation session is already locked to ${lockedBackend}. Start a new Codex task before switching backends so live and file-backed objects are never mixed.`);
    }
    if (requested === "officejs") {
      const status = await officeJsStatus(Number(args.wait_for_connection_ms || 0));
      if (!status.connected) throw new Error("Office.js task pane is not connected. Open Scientific Illustrator Live in the current PowerPoint deck and retry.");
    }
    backendPreference = requested;
    return {
      value: {
        backend_preference: backendPreference,
        host_preference: hostPreference,
        locked_backend: lockedBackend,
        locked_host: lockedHost,
        mutation_count: mutationCount,
        officejs_live: requested === "officejs" ? await officeJsStatus(0) : officeJsBridge.status(),
      },
    };
  }
  if (name === "powerpoint_set_focus_policy") {
    const requested = String(args.focus_policy || "preserve").toLowerCase();
    if (!VALID_FOCUS_POLICIES.has(requested)) throw new Error(`Unknown focus policy: ${requested}`);
    focusPolicy = requested;
    return {
      value: {
        focus_policy: focusPolicy,
        host_preference: hostPreference,
        behavior: focusPolicy === "preserve"
          ? "Ordinary drawing commands keep the user's current foreground application focused. powerpoint_activate_slide is still an explicit foreground action."
          : "Presentation windows may be foregrounded after drawing commands so object-by-object progress remains visible.",
        locked_backend: lockedBackend,
        locked_host: lockedHost,
        mutation_count: mutationCount,
      },
    };
  }
  if (name === "powerpoint_refresh") {
    const selected = await resolveBackend("status", args);
    if (selected !== "ooxml") {
      return {
        value: {
          backend: selected,
          refresh_required: false,
          refresh_verified: true,
          note: selected === "officejs"
            ? "Office.js commits each object through context.sync; no file-backed refresh is required."
            : "Windows PowerPoint COM edits the live presentation directly; no file-backed refresh is required.",
        },
      };
    }
    return { value: await runBridge("refresh", args) };
  }
  const actionMap = {
    powerpoint_status: "status",
    powerpoint_get_capabilities: "capabilities",
    powerpoint_launch: "launch",
    powerpoint_new_presentation: "new_presentation",
    powerpoint_inspect: "inspect",
    powerpoint_audit_figure: "audit_figure",
    powerpoint_activate_slide: "activate_slide",
    powerpoint_refresh: "refresh",
    powerpoint_add_slide: "add_slide",
    powerpoint_add_textbox: "add_textbox",
    powerpoint_add_shape: "add_shape",
    powerpoint_add_image: "add_image",
    powerpoint_add_line: "add_line",
    powerpoint_add_connector: "add_connector",
    powerpoint_add_table: "add_table",
    powerpoint_update_table_cell: "update_table_cell",
    powerpoint_update_table_layout: "update_table_layout",
    powerpoint_add_chart: "add_chart",
    powerpoint_duplicate_shape: "duplicate_shape",
    powerpoint_group_shapes: "group_shapes",
    powerpoint_ungroup_shape: "ungroup_shape",
    powerpoint_set_z_order: "set_z_order",
    powerpoint_align_shapes: "align_shapes",
    powerpoint_distribute_shapes: "distribute_shapes",
    powerpoint_update_shape: "update_shape",
    powerpoint_delete_shape: "delete_shape",
    powerpoint_export_slide_image: "export_slide_image",
    powerpoint_save: "save",
    powerpoint_close_presentation: "close_presentation",
    powerpoint_quit_application: "quit_application",
  };
  const action = actionMap[name];
  if (!action) throw new Error(`Unknown tool: ${name}`);
  const value = await runBridge(action, args);
  if (name === "powerpoint_get_capabilities") {
    const availableTools = new Set(tools.map((tool) => tool.name));
    const familyToolMap = {
      text_box: "powerpoint_add_textbox",
      auto_shape: "powerpoint_add_shape",
      free_line_or_arrow: "powerpoint_add_line",
      attached_connector: "powerpoint_add_connector",
      table: "powerpoint_add_table",
      chart: "powerpoint_add_chart",
      picture_or_svg: "powerpoint_add_image",
      duplicate: "powerpoint_duplicate_shape",
      group: "powerpoint_group_shapes",
      ungroup: "powerpoint_ungroup_shape",
      z_order: "powerpoint_set_z_order",
      align: "powerpoint_align_shapes",
      distribute: "powerpoint_distribute_shapes",
      figure_audit: "powerpoint_audit_figure",
    };
    value.native_object_families = (value.native_object_families || []).map((family) => {
      const mcpTool = familyToolMap[family.family] || null;
      return { ...family, mcp_tool: mcpTool, mcp_available: Boolean(mcpTool && availableTools.has(mcpTool)) };
    });
    value.mcp_coverage = {
      server_version: SERVER_VERSION,
      tool_count: tools.length,
      tools: [...availableTools].sort(),
      native_first_policy: "If PowerPoint exposes the semantic object and an MCP tool exists, native reconstruction is mandatory. Every picture must be one atomic irreducible raster unit with a decomposition note and must pass powerpoint_audit_figure.",
    };
  }
  if (name === "powerpoint_export_slide_image") {
    const imageData = await fs.readFile(value.output_path, { encoding: "base64" });
    return { value, imageData, mimeType: value.mime_type };
  }
  const delay = Number(args.pause_after_ms ?? 0);
  if (delay > 0) await sleep(Math.min(delay, 10000));
  return { value };
}

async function handleMessage(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    const requested = params?.protocolVersion;
    return rpcResult(id, {
      protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "Control Microsoft PowerPoint or WPS Presentation through the platform-selected backend. Windows PowerPoint prefers COM. Mac PowerPoint prefers a connected Office.js task pane and waits for context.sync after every object so drawing is visible; otherwise it reports and uses the file-backed OOXML fallback. WPS uses OOXML. Ordinary drawing preserves the user's foreground application by default; use powerpoint_set_focus_policy(foreground) only when the user explicitly wants PowerPoint/WPS kept in front, and use powerpoint_activate_slide for an intentional visible handoff. Call powerpoint_status, powerpoint_officejs_status when live Mac drawing is requested, and powerpoint_get_capabilities before editing. Never mix live and file-backed objects in one session, never use OS-level mouse or keyboard automation, preserve reconstructable content as native objects, require atomic raster declarations, and run structure plus renderer review after each region and the whole slide.",
    });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools });
  if (method === "tools/call") {
    try {
      const result = await handleTool(params?.name, params?.arguments || {});
      return rpcResult(id, toolResult(result.value, result));
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
  try {
    message = JSON.parse(line);
  } catch (error) {
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

// ---------------------------------------------------------------------------
// HTTP JSON-RPC mode (used by the sci-illu CLI's Office.js daemon)
//
// When SCI_ILLU_HTTP=host:port is set, the server also listens on that
// localhost port and accepts JSON-RPC 2.0 messages over HTTP. This keeps the
// ppt bridge (Office.js task pane connection, certificate, session token)
// alive across CLI invocations; the stdio MCP path above is unchanged and
// remains the Codex integration point.
// ---------------------------------------------------------------------------

const httpBind = String(process.env.SCI_ILLU_HTTP || "").trim();
if (httpBind) {
  const httpToken = String(process.env.SCI_ILLU_HTTP_TOKEN || "");
  const httpAuthorized = (request) => {
    if (!httpToken) return true; // token-less mode keeps the old localhost contract
    const header = String(request.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expected = Buffer.from(httpToken);
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  };
  const separator = httpBind.lastIndexOf(":");
  const host = separator > 0 ? httpBind.slice(0, separator) : "127.0.0.1";
  const port = Number(httpBind.slice(separator + 1));
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      const body = JSON.stringify({
        ok: true,
        version: SERVER_VERSION,
        name: SERVER_NAME,
        pid: process.pid,
        started_at: new Date().toISOString(),
        backend: "officejs-bridge-host",
      });
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      response.end(body);
      return;
    }
    if (request.method !== "POST") {
      const out = JSON.stringify(rpcError(null, -32600, "Method not allowed"));
      response.writeHead(405, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(out) });
      response.end(out);
      return;
    }
    if (!httpAuthorized(request)) {
      const out = JSON.stringify(rpcError(null, -32601, "Unauthorized: invalid or missing SCI_ILLU_HTTP_TOKEN."));
      response.writeHead(401, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(out) });
      response.end(out);
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    let message;
    try {
      message = JSON.parse(body);
    } catch (error) {
      const out = JSON.stringify(rpcError(null, -32700, "Parse error", error.message));
      response.writeHead(400, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(out) });
      response.end(out);
      return;
    }
    try {
      const result = await handleMessage(message);
      const out = JSON.stringify(result ?? { jsonrpc: "2.0", id: message.id ?? null, result: null });
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(out) });
      response.end(out);
    } catch (error) {
      const out = JSON.stringify(rpcError(message?.id, -32603, "Internal error", error.message));
      response.writeHead(500, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(out) });
      response.end(out);
    }
  });
  server.listen(port, host, () => {
    process.stderr.write(`[${SERVER_NAME}] HTTP JSON-RPC listening on http://${host}:${port}\n`);
  });
  server.on("error", (error) => {
    process.stderr.write(`[${SERVER_NAME}] HTTP server error: ${error.stack || error.message}\n`);
    process.exit(1);
  });
}
