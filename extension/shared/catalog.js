/* Font binaries and their licenses are bundled in fonts/. See fonts/sources.json. */
(() => {
  const groups = {
    sans: [
      "Inter", "DM Sans", "Manrope", "Geist", "Plus Jakarta Sans", "Outfit", "Poppins",
      "Roboto", "Open Sans", "Lato", "Montserrat", "Nunito", "Nunito Sans", "Raleway",
      "Work Sans", "Rubik", "Ubuntu", "Figtree", "Karla", "Mulish", "Barlow", "Cabin",
      "Quicksand", "Comfortaa", "Jost", "Urbanist", "Space Grotesk", "Sora", "Public Sans",
      "Red Hat Display", "Red Hat Text", "IBM Plex Sans", "Source Sans 3", "Noto Sans",
      "PT Sans", "Fira Sans", "Exo 2", "Rajdhani", "Titillium Web", "Josefin Sans",
      "Archivo", "Asap", "Assistant", "Overpass", "Oxygen", "Questrial", "Signika",
      "Varela Round", "Yantramanav", "Hind", "Heebo", "Vazirmatn", "Albert Sans",
      "Instrument Sans", "Schibsted Grotesk", "Epilogue", "Onest", "Gabarito",
      "Maven Pro", "Kanit", "Prompt", "Bricolage Grotesque", "Roboto Condensed"
    ],
    serif: [
      "Lora", "Literata", "Merriweather", "Source Serif 4", "DM Serif Display",
      "Playfair Display", "Libre Baskerville", "Crimson Pro", "Cormorant Garamond",
      "EB Garamond", "Bitter", "PT Serif", "Noto Serif", "IBM Plex Serif", "Spectral",
      "Newsreader", "Vollkorn", "Alegreya", "Cardo", "Bree Serif", "Domine", "Arvo",
      "Zilla Slab", "Roboto Slab", "Fraunces", "Bodoni Moda", "Gelasio", "Gentium Book Plus",
      "Cormorant", "Libre Caslon Text", "Noto Serif Display", "Young Serif", "Prata"
    ],
    mono: [
      "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", "Roboto Mono",
      "Space Mono", "Ubuntu Mono", "Inconsolata", "Cousine", "DM Mono", "Azeret Mono", "Geist Mono",
      "Martian Mono", "Noto Sans Mono", "Victor Mono"
    ],
    display: [
      "Bebas Neue", "Oswald", "Anton", "Abril Fatface", "Righteous", "Lobster",
      "Pacifico", "Alfa Slab One", "Cinzel", "Limelight", "Press Start 2P", "VT323",
      "Silkscreen", "Bungee", "Unbounded", "Syne", "Bowlby One"
    ],
    handwriting: [
      "Caveat", "Dancing Script", "Indie Flower", "Patrick Hand", "Kalam", "Shadows Into Light",
      "Architects Daughter", "Handlee", "Sacramento", "Satisfy", "Borel", "Homemade Apple",
      "Gloria Hallelujah"
    ],
    accessible: [
      "Atkinson Hyperlegible", "Atkinson Hyperlegible Next", "Lexend", "OpenDyslexic",
      "Inclusive Sans", "Readex Pro"
    ]
  };
  const notes = {
    inter: "A crisp, everyday favorite", literata: "Made for getting lost in a story",
    "atkinson-hyperlegible": "Distinct letterforms for easier reading",
    "atkinson-hyperlegible-next": "Clarity in every character", lexend: "Room to read comfortably",
    opendyslexic: "Weighted letterforms designed for dyslexic readers",
    "inclusive-sans": "Clear, friendly forms made for broad readability",
    "readex-pro": "A calm reading face with generous spacing",
    "jetbrains-mono": "A little precision, everywhere", lora: "A warm, literary feel",
    geist: "Clean lines, quiet confidence", "dm-sans": "Friendly, balanced, effortless"
  };
  const fonts = Object.entries(groups).flatMap(([category, names]) => names.map(name => {
    const id = name.toLowerCase().replaceAll(" ", "-");
    return { id, name, category, family: `Typewell ${name}`, file: `fonts/${id}.woff2`,
      note: notes[id] || "A fresh perspective on your everyday web", bundled: true };
  }));
  const systemFonts = [
    ["system-ui", "System UI", "sans-serif"], ["Arial", "Arial", "sans-serif"],
    ["Helvetica", "Helvetica", "sans-serif"], ["Verdana", "Verdana", "sans-serif"],
    ["Tahoma", "Tahoma", "sans-serif"], ["Trebuchet MS", "Trebuchet MS", "sans-serif"],
    ["Georgia", "Georgia", "serif"], ["Times New Roman", "Times New Roman", "serif"],
    ["Palatino", "Palatino", "serif"], ["Courier New", "Courier New", "monospace"],
    ["Menlo", "Menlo", "monospace"], ["Monaco", "Monaco", "monospace"]
  ];
  fonts.push(...systemFonts.map(([family, name, fallback]) => ({
    id: `system-${name.toLowerCase().replaceAll(" ", "-")}`, name, family, fallback,
    category: "system", bundled: false, note: "Uses this font if it is installed on your device"
  })));
  const T = globalThis.Typewell = globalThis.Typewell || {};
  T.fonts = fonts;
  T.fontById = Object.fromEntries(fonts.map(font => [font.id, font]));
  T.categories = { all: "All fonts", favorites: "Favorites", sans: "Sans", serif: "Serif", mono: "Mono",
    accessible: "Accessible", display: "Display", handwriting: "Handwriting", system: "System" };
  T.featured = ["inter", "lora", "atkinson-hyperlegible", "geist", "lexend", "jetbrains-mono", "dm-sans", "literata"];
})();
