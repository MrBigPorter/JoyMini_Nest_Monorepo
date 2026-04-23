const fs = require('fs');
const p = 'apps/admin-next/src/i18n';
const en = JSON.parse(fs.readFileSync(p + '/en.json','utf8'));
const locales = ['ja','ko','fr','de','zh'];
locales.forEach(locale=>{
  const fp = p + '/' + locale + '.json';
  if(!fs.existsSync(fp)){
    console.log('skip',locale,'no file');
    return;
  }
  const bak = fp + '.bak';
  if(!fs.existsSync(bak)) fs.copyFileSync(fp, bak);
  const cur = JSON.parse(fs.readFileSync(fp,'utf8'));
  const out = { translations: {}, blogCard: {} };
  const enTrans = en.translations || en;
  const enBlog = en.blogCard || {};
  const curTrans = cur.translations || cur;
  const curBlog = cur.blogCard || {};
  out.translations = Object.assign({}, enTrans, curTrans);
  out.blogCard = Object.assign({}, enBlog, curBlog);
  fs.writeFileSync(fp, JSON.stringify(out, null, 2) + '\n');
  console.log('merged', locale);
});

