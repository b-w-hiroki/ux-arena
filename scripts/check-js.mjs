import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
const checked=new Set();
for(const page of ['index.html','admin.html']){
 const html=readFileSync(page,'utf8');
 const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
 if(!scripts.length)throw Error(`${page}: no script`);
 for(const [,attributes,inline] of scripts){
  const src=attributes.match(/src="([^"]+)"/);
  const file=src?resolve(dirname(page),src[1]):`.syntax-${page}.js`;
  if(checked.has(file))continue;
  if(!src)writeFileSync(file,inline);
  const result=spawnSync('node',['--check',file],{stdio:'inherit'});
  if(!src)unlinkSync(file);
  if(result.status!==0)process.exit(1);
  checked.add(file);
 }
}
