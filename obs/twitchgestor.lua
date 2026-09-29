-- TwitchGestor per OBS
-- Avvia TwitchGestor quando apri OBS e lo chiude quando chiudi OBS.
-- Installazione: OBS > Strumenti > Script > "+" > scegli questo file.

obs = obslua

local project_dir = ""
local autostart = true
local stop_on_exit = true

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

local function file_exists(p)
  local f = io.open(p, "r")
  if f then
    f:close()
    return true
  end
  return false
end

-- cmd /c toglie la prima e l'ultima virgoletta: ne aggiungiamo un paio esterno
-- così quelle dentro al comando (percorsi con spazi) restano intatte.
local function run(cmd)
  os.execute('"' .. cmd .. '"')
end

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

local function start_program()
  if not is_windows() then
    obs.script_log(obs.LOG_WARNING, "L'avvio automatico è disponibile solo su Windows")
    return
  end
  local bat = win_path(project_dir) .. "\\Avvia.bat"
  if not file_exists(bat) then
    obs.script_log(obs.LOG_WARNING, "Avvia.bat non trovato in \"" .. project_dir .. "\": controlla la cartella nelle impostazioni dello script")
    return
  end
  -- Finestra ridotta a icona: la trovi nella barra delle applicazioni se vuoi leggere i messaggi.
  run('start "TwitchGestor" /min "' .. bat .. '" obs')
  obs.script_log(obs.LOG_INFO, "TwitchGestor avviato")
  schedule_refresh()
end

local function stop_program()
  if not is_windows() then return end
  run('taskkill /FI "WINDOWTITLE eq TwitchGestor*" /T /F >nul 2>nul')
  obs.script_log(obs.LOG_INFO, "TwitchGestor chiuso")
end

local function read_settings(settings)
  project_dir = obs.obs_data_get_string(settings, "project_dir")
  if project_dir == "" then project_dir = default_dir() end
  autostart = obs.obs_data_get_bool(settings, "autostart")
  stop_on_exit = obs.obs_data_get_bool(settings, "stop_on_exit")
end

function script_description()
  return "<b>TwitchGestor</b><br>Avvia il gestore di notifiche insieme a OBS e lo chiude quando esci."
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_path(props, "project_dir", "Cartella di TwitchGestor", obs.OBS_PATH_DIRECTORY, "", nil)
  obs.obs_properties_add_bool(props, "autostart", "Avvia TwitchGestor quando apro OBS")
  obs.obs_properties_add_bool(props, "stop_on_exit", "Chiudi TwitchGestor quando chiudo OBS")
  obs.obs_properties_add_button(props, "start_now", "Avvia ora", function()
    start_program()
    return false
  end)
  obs.obs_properties_add_button(props, "refresh_now", "Ricarica overlay", function()
    local n = refresh_overlays()
    obs.script_log(obs.LOG_INFO, "Overlay ricaricati: " .. n)
    return false
  end)
  obs.obs_properties_add_button(props, "stop_now", "Ferma", function()
    stop_program()
    return false
  end)
  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_string(settings, "project_dir", default_dir())
  obs.obs_data_set_default_bool(settings, "autostart", true)
  obs.obs_data_set_default_bool(settings, "stop_on_exit", true)
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
