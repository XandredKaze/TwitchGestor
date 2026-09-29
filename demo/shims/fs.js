// Nella demo non c'è un disco: tutto resta in memoria.
const noop = () => {};
export default { existsSync: () => false, readFileSync: () => '{}', writeFileSync: noop, mkdirSync: noop, statSync: () => ({ size: 0 }), renameSync: noop, createWriteStream: () => null, rmSync: noop };
