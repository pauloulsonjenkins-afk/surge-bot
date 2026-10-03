/**
 * Checks the Betfair match check against real pairs from 3 Oct 2026: a "name differs" match must be the same squad
 * with both teams the same club, so the wrong game is never offered for "Add name & send".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeExchange } from "../src/betfair/exchange";

const judge = (home: string, away: string, event: string) => judgeExchange(home, away, [event]).result;

test("names written differently for the same match still count", () => {
  assert.equal(judge("FC Fleury 91", "Caen", "Fleury Merogis v Caen"), "nameDiffers");
  assert.equal(judge("Rouen", "Bourg-Peronnas", "Rouen v Bourg-en-Bresse"), "nameDiffers");
  assert.equal(judge("United Arab Emirates", "Oman", "UAE v Oman"), "nameDiffers");
  assert.equal(judge("Kashiwa Reysol", "Gamba Osaka", "Kashiwa v G-Osaka"), "nameDiffers");
  assert.equal(judge("Dukla Praha", "FK Jablonec", "Dukla Prague v FK Jablonec"), "nameDiffers");
  assert.equal(judge("Independiente Rivadavia", "Gimnasia LP", "Independiente Rivadavia v Gimnasia La Plata"), "nameDiffers");
  assert.equal(judge("FK Austria Vienna (W)", "Inter Milan (W)", "FK Austria Wien (W) v Inter Milan (W)"), "nameDiffers");
  assert.equal(judge("Lyon", "Nantes", "Lyon v Nantes"), "on");
});

test("a different match sharing one team is not this match", () => {
  assert.equal(judge("Portugalete", "Alaves B", "Portugal v Norway"), "off");
  assert.equal(judge("Las Palmas C", "Lanzarote", "Las Palmas v Valladolid"), "off");
  assert.equal(judge("Rimini", "AC San Marino Calcio", "Belarus v San Marino"), "off");
  assert.equal(judge("Umeå FF", "Friska Viljor FC", "Umea FC v Hammarby TFF"), "off");
  assert.equal(judge("Sporting Gijon (W)", "Burgos (W)", "Sporting Gijon v Celta Vigo B"), "off");
});

test("women's and age-group matches are never the senior one", () => {
  assert.equal(judge("Yverdon Sport FC (W)", "Basel (W)", "Winterthur v FC Basel"), "off");
  assert.equal(judge("England U19", "USA U19", "England U21 v Slovakia U21"), "off");
  assert.equal(judge("China U23", "Uzbekistan U23", "South China v Tung Sing"), "off");
  assert.equal(judge("MFK Ruzomberok", "Opava", "Mlada Boleslav U19 v Opava U19"), "off");
  assert.equal(judge("England U19", "USA U19", "England v USA"), "off", "both names match, but it's the senior game");
  assert.equal(judge("Paris FC (W)", "Lens (W)", "Paris FC (W) v Lens (W)"), "on");
});
