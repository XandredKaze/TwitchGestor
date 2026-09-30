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

// Catalogo dei font per il selettore dei titoli di coda: [nome, categoria].
// Categorie: sans (moderni), serif (eleganti), display (decorativi), hand (scritti a mano), mono (monospazio).
(function () {
  const list = {
    sans: ['Poppins', 'Inter', 'Montserrat', 'Roboto', 'Open Sans', 'Lato', 'Raleway', 'Nunito', 'Nunito Sans', 'Ubuntu',
      'Rubik', 'Work Sans', 'Noto Sans', 'PT Sans', 'Mulish', 'Quicksand', 'Barlow', 'Barlow Condensed', 'Karla', 'Manrope',
      'DM Sans', 'Outfit', 'Figtree', 'Josefin Sans', 'Kanit', 'Fira Sans', 'Oxygen', 'Heebo', 'Cabin', 'Exo 2',
      'Titillium Web', 'Hind', 'Arimo', 'Assistant', 'Varela Round', 'Oswald', 'Archivo', 'Space Grotesk', 'Sora', 'Lexend',
      'Plus Jakarta Sans', 'Red Hat Display', 'Urbanist', 'Signika', 'Asap', 'Catamaran', 'Maven Pro', 'Prompt', 'Saira',
      'Chakra Petch', 'Teko', 'Rajdhani', 'Oxanium', 'Encode Sans', 'Public Sans', 'IBM Plex Sans', 'Source Sans 3',
      'Libre Franklin', 'Jost', 'M PLUS Rounded 1c', 'Comfortaa', 'Didact Gothic', 'Abel', 'Dosis', 'Play', 'Questrial'],
    serif: ['Cinzel', 'Playfair Display', 'Merriweather', 'Lora', 'PT Serif', 'Libre Baskerville', 'EB Garamond',
      'Cormorant Garamond', 'Cormorant', 'Crimson Text', 'Noto Serif', 'Roboto Slab', 'Bitter', 'Arvo', 'Zilla Slab',
      'Josefin Slab', 'Domine', 'Cardo', 'Spectral', 'Alegreya', 'Vollkorn', 'Old Standard TT', 'Prata', 'Abril Fatface',
      'DM Serif Display', 'Cinzel Decorative', 'Marcellus', 'Yeseva One', 'Rozha One', 'Bodoni Moda', 'Libre Caslon Text',
      'Source Serif 4', 'Frank Ruhl Libre', 'Gilda Display', 'Italiana', 'Forum', 'Philosopher', 'Cantata One'],
    display: ['Bebas Neue', 'Anton', 'Bangers', 'Luckiest Guy', 'Lilita One', 'Fredoka', 'Baloo 2', 'Righteous',
      'Russo One', 'Orbitron', 'Audiowide', 'Black Ops One', 'Bungee', 'Bungee Inline', 'Bungee Shade', 'Monoton',
      'Press Start 2P', 'VT323', 'Silkscreen', 'Creepster', 'Nosifer', 'Metal Mania', 'Pirata One', 'UnifrakturMaguntia',
      'Lobster', 'Lobster Two', 'Alfa Slab One', 'Archivo Black', 'Passion One', 'Titan One', 'Fugaz One', 'Staatliches',
      'Bowlby One SC', 'Carter One', 'Chewy', 'Special Elite', 'Faster One', 'Racing Sans One', 'Rubik Mono One',
      'Rubik Glitch', 'Rubik Bubbles', 'Rubik Wet Paint', 'Rampart One', 'Syncopate', 'Michroma', 'Ultra', 'Graduate',
      'Londrina Solid', 'Changa One', 'Days One', 'Gugi', 'Sigmar One', 'Paytone One', 'Holtwood One SC',
      'Cherry Cream Soda', 'Shojumaru', 'Knewave', 'Sniglet', 'Boogaloo', 'Coda', 'Righteous', 'Bangers'],
    hand: ['Pacifico', 'Caveat', 'Dancing Script', 'Great Vibes', 'Satisfy', 'Kaushan Script', 'Sacramento',
      'Permanent Marker', 'Indie Flower', 'Shadows Into Light', 'Amatic SC', 'Courgette', 'Cookie', 'Yellowtail', 'Allura',
      'Parisienne', 'Alex Brush', 'Tangerine', 'Homemade Apple', 'Rock Salt', 'Reenie Beanie', 'Gloria Hallelujah',
      'Patrick Hand', 'Architects Daughter', 'Handlee', 'Kalam', 'Just Another Hand', 'Covered By Your Grace',
      'Nothing You Could Do', 'Mr Dafoe', 'Marck Script', 'Pinyon Script', 'Italianno', 'Arizonia', 'Damion',
      'Mrs Saint Delafield', 'Bad Script', 'Caveat Brush', 'Rancho', 'Sedgwick Ave', 'Nanum Pen Script'],
    mono: ['Roboto Mono', 'Fira Code', 'Source Code Pro', 'JetBrains Mono', 'Space Mono', 'IBM Plex Mono', 'Inconsolata',
      'Share Tech Mono', 'Ubuntu Mono', 'Courier Prime', 'Major Mono Display', 'Overpass Mono', 'DM Mono', 'Cutive Mono',
      'Anonymous Pro'],
  };
  const seen = new Set();
  window.FONT_CATALOG = Object.entries(list).flatMap(([cat, names]) => names
    .filter((n) => !seen.has(n) && seen.add(n))
    .map((name) => ({ name, cat })));
  window.SYSTEM_FONTS = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Impact', 'Comic Sans MS', 'Courier New'];
  window.FONT_FALLBACK = { sans: 'sans-serif', serif: 'serif', display: 'sans-serif', hand: 'cursive', mono: 'monospace', system: 'sans-serif' };
})();
