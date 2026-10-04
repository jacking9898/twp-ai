const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('language list survives extension reload and still honors an explicit UI locale',()=>{
  let invalid=false,locale='default',calls=0;
  const sandbox={twpConfig:{get:()=>locale},chrome:{i18n:{getUILanguage(){calls++;if(invalid)throw new Error('Extension context invalidated.');return 'zh-CN';}}},navigator:{language:'en'}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync('src/lib/languages.js','utf8')+';this.lang=twpLang;',sandbox);
  const first=sandbox.lang.getLanguageList();invalid=true;
  assert.equal(sandbox.lang.getLanguageList(),first);assert.equal(calls,1);
  locale='en';assert.notEqual(sandbox.lang.getLanguageList(),first);assert.equal(calls,1);
  locale='default';const stale={...sandbox};vm.createContext(stale);vm.runInContext(fs.readFileSync('src/lib/languages.js','utf8')+';this.lang=twpLang;',stale);
  assert.equal(stale.lang.getLanguageList().en,'English');
});
