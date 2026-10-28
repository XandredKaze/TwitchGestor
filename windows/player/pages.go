package main

import (
	"html"
	"strings"
)

const style = `<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #121212; color: #f2f2f2; font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
.box { width: min(520px, calc(100vw - 32px)); padding: 28px; background: #161616; border: 1.5px solid #e6e6e6; box-shadow: 8px 8px 0 #c9a8e0; }
h1 { margin: 0 0 6px; font: 400 26px/1.1 Impact, "Arial Black", sans-serif; letter-spacing: .02em; text-transform: uppercase; } h1 span { color: #c9a8e0; }
p { margin: 8px 0; color: #b4b4b4; }
label { display: block; margin: 18px 0 6px; font: 13px Consolas, monospace; letter-spacing: .2em; text-transform: uppercase; color: #9c9c9c; }
label::before { content: "\25A0  "; color: #e6e6e6; }
input { width: 100%; padding: 11px 12px; border: 1.5px solid #3a3a3a; border-radius: 0; background: #121212; color: #fff; font: 15px Consolas, monospace; }
input:focus { outline: none; border-color: #e6e6e6; }
button { margin-top: 14px; padding: 10px 18px; border: 1.5px solid #e6e6e6; border-radius: 0; font: 700 15px "Segoe UI", sans-serif; color: #111; background: #c9a8e0; cursor: pointer; box-shadow: 4px 4px 0 #e6e6e6; }
button:active { transform: translate(3px, 3px); box-shadow: 1px 1px 0 #e6e6e6; }
button:disabled { opacity: .6; cursor: default; }
.msg { min-height: 1.5em; color: #ffb4b4; font-family: Consolas, monospace; }
.hint { font-size: 13px; color: #8a8a8a; }
code { font-family: Consolas, monospace; color: #c9a8e0; }
.spin { width: 34px; height: 34px; border: 3px solid #3a3a3a; border-top-color: #c9a8e0; animation: s 0.9s linear infinite; margin: 0 auto 16px; }
@keyframes s { to { transform: rotate(360deg); } }
</style>`

func loadingPage() string {
	return `<!doctype html><html lang="it"><meta charset="utf-8">` + style + `<body><div class="box" style="text-align:center"><div class="spin"></div><h1>Musicante <span>Player</span></h1><p>Cerco il Raspberry sulla rete…</p></div></body></html>`
}

func setupPage(current, msg string) string {
	page := `<!doctype html><html lang="it"><meta charset="utf-8">` + style + `<body><form class="box" id="f">
<h1>Musicante <span>Player</span></h1>
<p>Ascolta sul PC la musica del Raspberry: quella scaricata con Musicante e le playlist di TwitchGestor.</p>
<label for="a">Indirizzo del Raspberry</label>
<input id="a" value="{{CURRENT}}" placeholder="twitchgestor" autofocus>
<p class="hint">A casa di solito basta <code>twitchgestor</code> (oppure il suo indirizzo, tipo <code>192.168.1.79</code>). Fuori casa, con Tailscale: <code>100.76.162.8</code>.</p>
<p class="msg" id="m">{{MSG}}</p>
<button id="b" type="submit">Collega</button>
</form>
<script>
document.getElementById('f').onsubmit = async (e) => {
  e.preventDefault();
  const b = document.getElementById('b'), m = document.getElementById('m');
  b.disabled = true; b.textContent = 'Provo…'; m.textContent = '';
  try { await window.musicanteConnect(document.getElementById('a').value); }
  catch (err) { m.textContent = String(err && err.message || err); b.disabled = false; b.textContent = 'Collega'; }
};
</script></body></html>`
	page = strings.Replace(page, "{{CURRENT}}", html.EscapeString(strings.TrimPrefix(current, "http://")), 1)
	return strings.Replace(page, "{{MSG}}", html.EscapeString(msg), 1)
}
