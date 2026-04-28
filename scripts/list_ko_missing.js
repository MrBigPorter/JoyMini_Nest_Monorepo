const fs = require("fs");
const p = "apps/admin-next/src/i18n";
const en = JSON.parse(fs.readFileSync(p + "/en.json", "utf8"));
const koBakPath = p + "/ko.json.bak";
const koCurrPath = p + "/ko.json";
const koBak = fs.existsSync(koBakPath)
  ? JSON.parse(fs.readFileSync(koBakPath, "utf8"))
  : null;
const koCurr = JSON.parse(fs.readFileSync(koCurrPath, "utf8"));
function flat(obj) {
  const res = {};
  if (obj.translations) Object.assign(res, obj.translations);
  else Object.assign(res, obj);
  if (obj.blogCard) res.blogCard = Object.assign({}, obj.blogCard);
  return res;
}
const enFlat = flat(en);
const koBakFlat = koBak ? flat(koBak) : null;
const koCurrFlat = flat(koCurr);
const missingInBak = [];
Object.keys(enFlat).forEach((k) => {
  if (koBakFlat) {
    if (k === "blogCard") return;
    if (!(k in koBakFlat)) missingInBak.push(k);
  }
});
if (en.blogCard) {
  Object.keys(en.blogCard).forEach((k) => {
    if (!koBakFlat || !koBakFlat.blogCard || !(k in koBakFlat.blogCard))
      missingInBak.push("blogCard." + k);
  });
}
const filledWithEnglish = [];
Object.keys(enFlat).forEach((k) => {
  if (k === "blogCard") return;
  const env = enFlat[k];
  const kov = koCurrFlat[k] === undefined ? null : koCurrFlat[k];
  if (kov !== null && kov === env) filledWithEnglish.push(k);
});
if (en.blogCard) {
  Object.keys(en.blogCard).forEach((k) => {
    const enV = en.blogCard[k];
    const koV =
      koCurrFlat.blogCard && koCurrFlat.blogCard[k] !== undefined
        ? koCurrFlat.blogCard[k]
        : null;
    if (koV !== null && koV === enV) filledWithEnglish.push("blogCard." + k);
  });
}
fs.writeFileSync(p + "/ko.missing_keys.txt", missingInBak.join("\n"));
fs.writeFileSync(
  p + "/ko.filled_with_english.txt",
  filledWithEnglish.join("\n"),
);
console.log("missing count (original ko):", missingInBak.length);
console.log("filled-with-english count:", filledWithEnglish.length);
console.log(
  "Files written:",
  p + "/ko.missing_keys.txt",
  p + "/ko.filled_with_english.txt",
);
