import { loadRuntime } from './reference-runner/runtime.mjs';
const {build} = await loadRuntime();
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

async function load(original) {
  const bundle = await build({entryPoints: ['src/synth.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: original ? [{name: 'original', setup(builder) {
    builder.onLoad({filter: /[\\/]src[\\/]synth\.ts$/}, () => ({contents: execFileSync('git', ['show', '4c65f4a781c8cb0a19310d0079d0da2c9f844116:src/synth.ts'], {encoding: 'utf8'}), loader: 'ts'}));
  }}] : []});
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
function random(seed) {let state=seed; return () => {state+=0x6D2B79F5;let n=state;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return ((n^n>>>14)>>>0)/4294967296;};}
function context(rate) {
  const calls=[], buffers=[]; let next=0;
  const node=kind=>{
    const id=next++, result={id}; calls.push(['node',kind,id]);
    for(const key of ['gain','frequency','Q']) result[key]=Object.fromEntries(['setValueAtTime','linearRampToValueAtTime','exponentialRampToValueAtTime'].map(method=>[method,(...args)=>calls.push([id,key,method,...args])]));
    for(const key of ['start','stop','disconnect']) result[key]=(...args)=>calls.push([id,key,...args]);
    result.connect=target=>{calls.push([id,'connect',target.id]);return target;};
    result.addEventListener=()=>{}; result.removeEventListener=()=>{};
    return new Proxy(result,{set(target,key,value){if(key==='buffer') calls.push([id,key,buffers.indexOf(value)]);else calls.push([id,key,value]);target[key]=value;return true;}});
  };
  return {calls,buffers,context:{sampleRate:rate,state:'running',currentTime:0,destination:node('destination'),createGain:()=>node('gain'),createBiquadFilter:()=>node('filter'),createOscillator:()=>node('oscillator'),createBufferSource:()=>node('source'),createBuffer:(_channels,length)=>{const samples=new Float32Array(length),buffer={samples,getChannelData:()=>samples};buffers.push(buffer);return buffer;}}};
}
const [original,current]=await Promise.all([load(true),load(false)]);
let checked=0;
for(const rate of [44100,48000]) for(const seed of [1,17,42,123,1024,65537,1234567,4294967294]) {
  const runs=[];
  for(const implementation of [original,current]) {
    const mock=context(rate), previous=Math.random;
    try {
      Math.random=random(seed); const synth=new implementation.DrumSynth(mock.context); await synth.start();
      for(const kind of ['kick','snare','tomHigh','tomMid','tomLow','hatClosed','hatHalfOpen','hatOpen','hatFoot','hatFootSplash','ride','rideBell','crash','splash','china','stack','cowbell','click']) for(const articulation of ['normal','accent','ghost','flam','drag','diddle','buzz','choke']) {
        synth.scheduleHits([{instrument:{playback:kind},articulation,velocity:0.7}],0.1,0.5,0.5);
      }
      runs.push({calls:mock.calls,hashes:mock.buffers.map(buffer=>createHash('sha256').update(new Uint8Array(buffer.samples.buffer)).digest('hex'))});
    } finally {Math.random=previous;}
  }
  assert.deepEqual(runs[1],runs[0]);checked++;
}
console.log(`Exact buffer and scheduling equivalence: ${checked} seed/sample-rate combinations, 144 voice/articulation combinations each.`);
