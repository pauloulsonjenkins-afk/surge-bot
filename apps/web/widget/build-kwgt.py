"""
Builds GoalBrew-Today.kwgt, the KWGT widget described in ../WIDGET.md, ready to import on the phone.

Run from this folder:  python build-kwgt.py
The widget address (with its key) is NOT in the file: after importing, open the widget's Globals and paste it into gb.
The format follows a real KWGT export (preset.json plus thumbnails in a zip). Tap the left half to refresh the
figures, the right half to open GoalBrew's Today page.
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


def tap_area(title, anchor, event):
    return {
        "internal_type": "ShapeModule",
        "internal_title": title,
        "shape_type": "RECT",
        "shape_width": float(W / 2),
        "shape_height": float(H),
        "paint_color": "#00000000",  # invisible: it only catches the tap
        "position_anchor": anchor,
        "internal_events": [event],
    }


items = [
    {
        "internal_type": "ShapeModule",
        "internal_title": "Background",
        "shape_type": "RECT",
        "shape_width": float(W - 16),
        "shape_height": float(H - 16),
        "shape_corners": 40.0,
        "paint_color": "#F0141A1F",
    },
    text("Betting status", f"Betting {field('status')}", 44, "TOPLEFT", 40, 34, color_formula=f"$wg(gv(gb), json, \".statusColor\")$"),
    text("Updated", f"↻ {field('updated')}", 28, "TOPRIGHT", 40, 40, color="#B3FFFFFF"),
    text("Today's Live P/L", f"Today {field('livePL')}", 66, "CENTERLEFT", 40, -6, color_formula=f"$wg(gv(gb), json, \".livePLColor\")$"),
    text("Warning", field("warning"), 28, "CENTERRIGHT", 40, -6, align="RIGHT", width=380, color_formula=f"$wg(gv(gb), json, \".warningColor\")$"),
    text("Balance and money out", f"Balance {field('balance')} · Out {field('moneyOut')}", 32, "BOTTOMLEFT", 40, 92),
    text("Alerts and not placed", f"{field('alertsHour')} alerts/hr · Not placed {field('notPlaced')}", 30, "BOTTOMLEFT", 40, 44, color="#B3FFFFFF"),
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
