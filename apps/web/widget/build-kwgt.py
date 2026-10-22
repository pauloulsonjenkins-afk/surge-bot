"""
Builds GoalBrew-Today.kwgt, the KWGT widget described in ../WIDGET.md, ready to import on the phone.

Run from this folder:  python build-kwgt.py
The widget address (with its key) is NOT in the file: after importing, open the widget's Globals and paste it into gb.
The format follows a real KWGT export (preset.json plus thumbnails in a zip). Tap the left half to refresh the
figures, the right half to open GoalBrew's Today page.

KWGT scales a preset to the widget's real size on the phone, so nothing here assumes a size: the background and the
two tap halves take the widget's own width and height ($si(rwidth)$, $si(rheight)$), and the lines sit in a stack
one under another, so a longer figure pushes the next line down instead of overlapping it.
"""
import io
import json
import zipfile

from PIL import Image, ImageDraw

W, H = 976, 458  # the editor canvas: a 4x2 widget
TODAY = "https://seashell-app-z8xl5.ondigitalocean.app/more/admin/today"


def field(name: str) -> str:
    return f'$wg(gv(gb), json, ".{name}")$'


def text(title, expr, size, anchor, x=0.0, y=0.0, color="#FFFFFFFF", color_formula=None, align=None, width=None):
    t = {
        "internal_type": "TextModule",
        "internal_title": title,
        "text_expression": expr,
        "text_size": float(size),
        "position_anchor": anchor,
        "paint_color": color,
    }
    if x:
        t["position_offset_x"] = float(x)
    if y:
        t["position_offset_y"] = float(y)
    if align:
        t["text_align"] = align
    if width:
        t["text_size_type"] = "FIXED_WIDTH"
        t["text_width"] = float(width)
    if color_formula:
        t["internal_toggles"] = {"paint_color": 10}
        t["internal_formulas"] = {"paint_color": color_formula}
    return t


def sized(shape, width, height):
    """A shape whose width and height are formulas (the widget's own size), with a fallback number."""
    shape["internal_toggles"] = {**shape.get("internal_toggles", {}), "shape_width": 10, "shape_height": 10}
    shape["internal_formulas"] = {**shape.get("internal_formulas", {}), "shape_width": width, "shape_height": height}
    return shape


def tap_area(title, anchor, event):
    return sized(
        {
            "internal_type": "ShapeModule",
            "internal_title": title,
            "shape_type": "RECT",
            "shape_width": float(W / 2),
            "shape_height": float(H),
            "paint_color": "#00000000",  # invisible: it only catches the tap
            "position_anchor": anchor,
            "internal_events": [event],
        },
        "$si(rwidth) / 2$",
        "$si(rheight)$",
    )


ROW = 30.0  # text size of the right-hand rows (the same as the Balance line)
SIM_COLOR = '$if(wg(gv(gb), json, ".raw.simNet") > 0, "#FF5CC48F", wg(gv(gb), json, ".raw.simNet") < 0, "#FFE86B55", "#FFF1E9DF")$'
RIGHT_ROWS = [
    ("Bets today", field("betsToday"), ("#FFF1E9DF", None)),
    ("Settled", field("liveSettled"), ("#FFF1E9DF", None)),
    ("Waiting", field("waiting"), ("#FFF1E9DF", None)),
    ("Exposure", field("exposure"), ("#FFF1E9DF", None)),
    ("Sim today", field("simPL"), ("#FFF1E9DF", SIM_COLOR)),
]


def stack(title, stacking, anchor, offset_x, children, margin=4.0):
    return {
        "internal_type": "StackLayerModule",
        "internal_title": title,
        "config_stacking": stacking,
        "config_margin": margin,
        "position_anchor": anchor,
        "position_offset_x": float(offset_x),
        "viewgroup_items": children,
    }


lines = {
    "internal_type": "StackLayerModule",
    "internal_title": "Figures",
    "config_stacking": "VERTICAL_LEFT",
    "config_margin": 6.0,
    "position_anchor": "CENTERLEFT",
    "position_offset_x": 40.0,
    "viewgroup_items": [
        text("Betting status", f"Betting {field('status')}", 40, "TOPLEFT", color_formula=f"$wg(gv(gb), json, \".statusColor\")$"),
        text("Today's Live P/L", f"Today {field('livePL')}", 58, "TOPLEFT", color_formula=f"$wg(gv(gb), json, \".livePLColor\")$"),
        text("Balance and money out", f"Balance {field('balance')} · Out {field('moneyOut')}", 30, "TOPLEFT"),
        text("Alerts and not placed", f"{field('alertsHour')} alerts/hr · Not placed {field('notPlaced')}", 28, "TOPLEFT", color="#B3FFFFFF"),
        text("Warning", field("warning"), 28, "TOPLEFT", color_formula=f"$wg(gv(gb), json, \".warningColor\")$"),
    ],
}

items = [
    sized(
        {
            "internal_type": "ShapeModule",
            "internal_title": "Background",
            "shape_type": "RECT",
            "shape_width": float(W),
            "shape_height": float(H),
            "shape_corners": 40.0,
            "paint_color": "#F0141A1F",
        },
        "$si(rwidth)$",
        "$si(rheight)$",
    ),
    lines,
    # The right half, kept together in one row so it can't drift: a thin divider line, a column of labels, and a column
    # of values (the same size and spacing as the labels, so the rows line up).
    stack(
        "Right column",
        "HORIZONTAL_CENTER",
        "CENTERRIGHT",
        48,
        [
            # A soft line: white at a third strength reads on the dark background without shouting.
            {
                "internal_type": "ShapeModule",
                "internal_title": "Divider",
                "shape_type": "RECT",
                "shape_width": 4.0,
                "shape_height": 200.0,
                "shape_corners": 2.0,
                "paint_color": "#55FFFFFF",
                "internal_toggles": {"shape_height": 10},
                "internal_formulas": {"shape_height": "$si(rheight) * 0.62$"},
            },
            stack("Right labels", "VERTICAL_LEFT", "CENTER", 0, [text(k, k, ROW, "TOPLEFT", color="#B3FFFFFF") for k, _, _ in RIGHT_ROWS]),
            stack("Right values", "VERTICAL_RIGHT", "CENTER", 0, [text(k, v, ROW, "TOPRIGHT", color=c, color_formula=cf) for k, v, (c, cf) in RIGHT_ROWS]),
        ],
        margin=56.0,
    ),
    text("Updated", f"↻ {field('updated')}", 26, "TOPRIGHT", 40, 36, color="#B3FFFFFF"),
    text("Open hint", "Open GoalBrew ›", 22, "BOTTOMRIGHT", 40, 26, color="#FFD6AA50"),
    # Last in the list, so they sit on top of everything and catch the taps.
    tap_area("Tap left: refresh", "CENTERLEFT", {"type": "SINGLE_TAP", "action": "KUSTOM_ACTION", "kustom_action": "TEXT_UPDATE"}),
    tap_area("Tap right: open GoalBrew", "CENTERRIGHT", {"type": "SINGLE_TAP", "action": "OPEN_LINK", "url": TODAY}),
]

preset = {
    "preset_info": {
        "archive": None,
        "author": "GoalBrew",
        "description": "GoalBrew Today: betting status, today's Live P/L, balance, alerts. Tap left to refresh, right to open GoalBrew. Paste your widget address into the gb global.",
        "email": "",
        "features": "DOWNLOAD",
        "pflags": 0,
        "height": H,
        "locked": False,
        "release": 377435216,
        "title": "GoalBrew Today",
        "version": 13,
        "width": W,
        "xscreens": 0,
        "yscreens": 0,
    },
    "preset_root": {
        "internal_type": "RootLayerModule",
        "globals_list": {
            "gb": {
                "index": 1,
                "type": "TEXT",
                "title": "gb",
                "description": "Your widget address: https://seashell-app-z8xl5.ondigitalocean.app/api/widget?key=YOUR_KEY",
                "value": "PASTE YOUR WIDGET ADDRESS HERE",
            }
        },
        "viewgroup_items": items,
    },
}


def thumb(w: int, h: int) -> bytes:
    """A plain preview: the widget's look without live figures."""
    img = Image.new("RGB", (w, h), (20, 26, 31))
    d = ImageDraw.Draw(img)
    s = w / W
    d.text((40 * s, 34 * s), "Betting On", fill=(80, 200, 120))
    d.text((40 * s, h / 2 - 10 * s), "Today +£0.00", fill=(255, 255, 255))
    d.text((40 * s, h - 92 * s), "Balance · Out", fill=(220, 220, 220))
    d.text((w - 200 * s, 40 * s), "GoalBrew", fill=(200, 160, 60))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85)
    return out.getvalue()


with zipfile.ZipFile("GoalBrew-Today.kwgt", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("preset.json", json.dumps(preset, ensure_ascii=False, indent=1))
    z.writestr("preset_thumb_portrait.jpg", thumb(W, H))
    z.writestr("preset_thumb_landscape.jpg", thumb(W, H))
print("GoalBrew-Today.kwgt written")
