import test from 'node:test';
import assert from 'node:assert/strict';
import { compareGeometryEvidence } from '../server/benchmark.mjs';
test('imported STL geometry gate rejects altered mesh, lost shell or absent protected evidence',()=>{
 const a={version:1,components:[{id:'shell-0',triangles:12,sha256:'preserved-world-triangles'}]};
 assert.equal(compareGeometryEvidence(a,structuredClone(a),true).pass,true);
 assert.equal(compareGeometryEvidence(a,{...a,components:[{...a.components[0],sha256:'changed'}]},true).pass,false);
 assert.equal(compareGeometryEvidence(a,{...a,components:[]},true).pass,false);
 assert.equal(compareGeometryEvidence(null,null,true).pass,false);
 assert.equal(compareGeometryEvidence(null,null,false).checked,false);
});
