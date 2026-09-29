const join = (...p) => p.filter(Boolean).join('/');
export default { join, resolve: join, dirname: (p) => String(p).split('/').slice(0, -1).join('/'), basename: (p) => String(p).split('/').pop(), extname: (p) => (/\.[^./]+$/.exec(p) || [''])[0] };
