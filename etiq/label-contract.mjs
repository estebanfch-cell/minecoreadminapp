/** Contrato del perfil Clientes. Mismo tamaño que MCLbl (51×19 mm apaisado) y el stock 30330 (~19×50.8 mm). */
export const CLIENTES = {
  profile: 'clientes',
  width_mm: 51,
  height_mm: 19,
  paper: '30330',
  fields: ['nombre', 'cod_prov', 'categoria', 'sku', 'linea']
};

export const FORBIDDEN_JOB_KEYS = ['url', 'cmd', 'shell', 'cups_queue', 'lp', 'argv', 'printer', 'destination'];
