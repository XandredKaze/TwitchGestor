// Font disponibili per gli alert. Quelli di Google Fonts vengono scaricati al primo uso
// (serve Internet); quelli di sistema sono già presenti su Windows.
(function () {
  const GOOGLE = [
    'Poppins', 'Montserrat', 'Roboto', 'Open Sans', 'Oswald', 'Bebas Neue', 'Anton', 'Bangers',
    'Luckiest Guy', 'Lilita One', 'Fredoka', 'Baloo 2', 'Righteous', 'Russo One', 'Orbitron',
    'Press Start 2P', 'VT323', 'Permanent Marker', 'Lobster', 'Pacifico', 'Caveat', 'Creepster',
  ];
  const SYSTEM = ['Segoe UI', 'Arial', 'Impact', 'Comic Sans MS', 'Georgia', 'Courier New'];
  const loaded = new Set();

  window.ALERT_FONTS = { google: GOOGLE, system: SYSTEM };

  window.loadFont = function (name) {
    if (!name || !GOOGLE.includes(name) || loaded.has(name)) return;
    loaded.add(name);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}&display=swap`;
    document.head.append(link);
  };

  window.fontStack = function (name) {
    return `'${String(name || 'Poppins').replace(/'/g, '')}', 'Segoe UI', sans-serif`;
  };
})();
