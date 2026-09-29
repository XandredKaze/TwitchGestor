-- TwitchGestor per OBS
-- Avvia TwitchGestor (senza finestre) quando apri OBS e lo spegne quando chiudi OBS.
-- Installazione: OBS > Strumenti > Script > "+" > scegli questo file.

obs = obslua

local project_dir = ""
local autostart = true
local stop_on_exit = true
local show_window = false
local port = 3000

local function is_windows()
  return package.config:sub(1, 1) == "\\"
end

-- Lo script sta in <cartella del programma>/obs/, quindi la cartella del programma è quella sopra.
local function default_dir()
  local dir = script_path():gsub("[/\\]+$", "")
  return (dir:gsub("[/\\][^/\\]+$", ""))
end

local function win_path(p)
  return (p:gsub("/", "\\"))
end

-- ---------- Avvio di programmi senza finestre (API di Windows tramite LuaJIT FFI) ----------

local ffi_ok, ffi = pcall(require, "ffi")
local shell32 = nil
if ffi_ok and is_windows() then
  pcall(ffi.cdef, [[
    int MultiByteToWideChar(unsigned int cp, unsigned long flags, const char* str, int len, wchar_t* out, int outlen);
    void* ShellExecuteW(void* hwnd, const wchar_t* op, const wchar_t* file, const wchar_t* params, const wchar_t* dir, int show);
  ]])
  local ok, lib = pcall(ffi.load, "shell32")
  if ok then shell32 = lib end
end

local SW_HIDE = 0
local SW_SHOWMINNOACTIVE = 7

-- Testo UTF-8 (quello di OBS) -> UTF-16 per Windows: così funzionano anche i percorsi con lettere accentate.
local function wide(s)
  if s == nil then return nil end
  local n = ffi.C.MultiByteToWideChar(65001, 0, s, -1, nil, 0)
  local buf = ffi.new("wchar_t[?]", n)
  ffi.C.MultiByteToWideChar(65001, 0, s, -1, buf, n)
  return buf
end

-- Avvia un programma senza aspettare. Ritorna true se Windows lo ha avviato.
local function launch(file, params, dir, show)
  if shell32 ~= nil then
    local result = shell32.ShellExecuteW(nil, wide("open"), wide(file), wide(params), wide(dir), show)
    return tonumber(ffi.cast("intptr_t", result)) > 32
  end
  -- Ripiego senza FFI: funziona lo stesso ma può comparire per un attimo una finestrella nera.
  -- cmd /c toglie la prima e l'ultima virgoletta: ne aggiungiamo un paio esterno.
  os.execute('"start "" /min "' .. file .. '" ' .. (params or "") .. '"')
  return true
end

-- ---------- Ricarica dell'overlay ----------

-- Ricarica le sorgenti Browser che mostrano l'overlay di TwitchGestor.
-- Serve perché OBS carica la pagina appena si apre, quando il programma magari non è ancora pronto:
-- in quel caso la pagina resta vuota e non riprova da sola.
local function refresh_overlays()
  local sources = obs.obs_enum_sources()
  if sources == nil then return 0 end
  local count = 0
  for _, source in ipairs(sources) do
    if obs.obs_source_get_unversioned_id(source) == "browser_source" then
      local data = obs.obs_source_get_settings(source)
      local url = obs.obs_data_get_string(data, "url")
      obs.obs_data_release(data)
      if url:match("^https?://localhost[:/].*/overlay") or url:match("^https?://127%.0%.0%.1[:/].*/overlay") then
        local props = obs.obs_source_properties(source)
        local refresh = obs.obs_properties_get(props, "refreshnocache")
        if refresh ~= nil then
          obs.obs_property_button_clicked(refresh, source)
          count = count + 1
        end
        obs.obs_properties_destroy(props)
      end
    end
  end
  obs.source_list_release(sources)
  return count
end

-- Dopo l'avvio ricarica l'overlay a 4, 10, 20 e 40 secondi (la prima installazione può richiedere più tempo).
local REFRESH_AT = { [2] = true, [5] = true, [10] = true, [20] = true }
local ticks = 0

local function refresh_tick()
  ticks = ticks + 1
  if REFRESH_AT[ticks] then refresh_overlays() end
  if ticks >= 20 then obs.timer_remove(refresh_tick) end
end

local function schedule_refresh()
  obs.timer_remove(refresh_tick)
  ticks = 0
  obs.timer_add(refresh_tick, 2000)
end

-- ---------- Avvio e spegnimento ----------

local function start_program()
  if not is_windows() then
    obs.script_log(obs.LOG_WARNING, "L'avvio automatico è disponibile solo su Windows")
    return
  end
  local dir = win_path(project_dir)
  local ok
  if show_window then
    ok = launch(dir .. "\\Avvia.bat", "obs", dir, SW_SHOWMINNOACTIVE)
  else
    ok = launch("wscript.exe", '"' .. dir .. '\\Avvia TwitchGestor.vbs" obs', dir, SW_HIDE)
  end
  if ok then
    obs.script_log(obs.LOG_INFO, "TwitchGestor avviato" .. (show_window and "" or " (senza finestra)"))
    schedule_refresh()
  else
    obs.script_log(obs.LOG_WARNING, "Impossibile avviare TwitchGestor da \"" .. project_dir .. "\": controlla la cartella nelle impostazioni dello script")
  end
end

local function stop_program()
  if not is_windows() then return end
  -- Chiede al programma di spegnersi (salva lo storico prima di uscire). curl è incluso in Windows 10 e 11.
  launch("curl.exe", "-s -m 5 -X POST -H \"x-twitchgestor-stop: 1\" http://127.0.0.1:" .. port .. "/api/shutdown", nil, SW_HIDE)
  obs.script_log(obs.LOG_INFO, "Richiesto lo spegnimento di TwitchGestor")
end

-- ---------- Impostazioni dello script ----------

local function read_settings(settings)
  project_dir = obs.obs_data_get_string(settings, "project_dir")
  if project_dir == "" then project_dir = default_dir() end
  autostart = obs.obs_data_get_bool(settings, "autostart")
  stop_on_exit = obs.obs_data_get_bool(settings, "stop_on_exit")
  show_window = obs.obs_data_get_bool(settings, "show_window")
  port = obs.obs_data_get_int(settings, "port")
  if port <= 0 then port = 3000 end
end

function script_description()
  return "<b>TwitchGestor</b><br>Avvia il gestore di notifiche insieme a OBS (senza finestre) e lo spegne quando esci."
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_path(props, "project_dir", "Cartella di TwitchGestor", obs.OBS_PATH_DIRECTORY, "", nil)
  obs.obs_properties_add_bool(props, "autostart", "Avvia TwitchGestor quando apro OBS")
  obs.obs_properties_add_bool(props, "stop_on_exit", "Spegni TwitchGestor quando chiudo OBS")
  obs.obs_properties_add_bool(props, "show_window", "Mostra la finestra del programma (per leggere i messaggi)")
  obs.obs_properties_add_int(props, "port", "Porta (cambiala solo se l'hai cambiata nel file .env)", 1, 65535, 1)
  obs.obs_properties_add_button(props, "start_now", "Avvia ora", function()
    start_program()
    return false
  end)
  obs.obs_properties_add_button(props, "refresh_now", "Ricarica overlay", function()
    local n = refresh_overlays()
    obs.script_log(obs.LOG_INFO, "Overlay ricaricati: " .. n)
    return false
  end)
  obs.obs_properties_add_button(props, "stop_now", "Spegni", function()
    stop_program()
    return false
  end)
  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_string(settings, "project_dir", default_dir())
  obs.obs_data_set_default_bool(settings, "autostart", true)
  obs.obs_data_set_default_bool(settings, "stop_on_exit", true)
  obs.obs_data_set_default_bool(settings, "show_window", false)
  obs.obs_data_set_default_int(settings, "port", 3000)
end

function script_update(settings)
  read_settings(settings)
end

function script_load(settings)
  read_settings(settings)
  if autostart then start_program() end
end

function script_unload()
  obs.timer_remove(refresh_tick)
  if stop_on_exit then stop_program() end
end
