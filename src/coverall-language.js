export function normalizeCoverAllLanguage(value) {
  const language=String(value||'en').trim().toLowerCase();
  return ['en','es','both'].includes(language)?language:'en';
}
const EN={title:'CoverAll Assignments',shift:'Shift',areas:'Assigned areas',restrooms:'Public restrooms',other:'Exhibits',none:'No assignments posted yet.',language:'Español',notice:'Review your assigned areas. No access to other tools is provided.'};
const ES={title:'Asignaciones de CoverAll',shift:'Turno',areas:'Áreas asignadas',restrooms:'Baños públicos',other:'Exhibiciones',none:'No hay asignaciones publicadas todavía.',language:'English',notice:'Revise sus áreas asignadas. No hay acceso a otras herramientas.'};
export function coverAllLabels(value) {
  const language=normalizeCoverAllLanguage(value);
  if(language==='en')return {...EN};
  if(language==='es')return {...ES};
  return Object.fromEntries(Object.keys(EN).map(key=>[key,`${EN[key]} / ${ES[key]}`]));
}
