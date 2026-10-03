(function(root,factory) {
  if(typeof module==='object' && module.exports) module.exports=factory(require('./workflow-core.js'));
  else root.DoiWorkflowEngine=factory(root.DoiWorkflowCore);
})(typeof window==='undefined'?globalThis:window,function(C) {
  'use strict';
  // IO is injected, allowing failure/recovery tests without calling a real AI.
  function create(io) {
    async function run(jobId,onProgress=()=>{}) {
      let token=io.uuid(),claimed=false,completed=false,errorText=null;
      try {
        let bundle=await io.load(jobId);
        const job=await io.claim(bundle,token); claimed=true;
        for(const key of C.ordered(job.requested_keys)) {
          bundle=await io.load(jobId);
          if(bundle.hashes.base!==job.input_hash) throw new Error('Dữ kiện hoặc nguồn đã thay đổi. Bấm tiếp tục để dùng bản mới.');
          const available=C.latest(bundle.documents);
          const force=(job.force_keys||[]).includes(key) && available[key]?.job_id!==jobId;
          if(!force && C.reusable(available[key],bundle.hashes,available)) { onProgress(key,'reused'); continue; }
          // Only current documents can be inherited. A stale document is never a silent source.
          const refs=Object.fromEntries(Object.entries(available).filter(([,d])=>C.reusable(d,bundle.hashes,available)));
          const deps=C.dependencies(key,refs);
          const hash=C.inputHash(key,bundle.hashes);
          if(['report','fanpage'].includes(key) && hash!==job.context_snapshot.report_hash) throw new Error('Kết quả thực tế vừa thay đổi. Bấm tiếp tục để dùng bản mới.');
          const documentId=await io.documentId(jobId,key,hash,deps);
          let savedResponse=await io.buffer.get(documentId);
          if(!savedResponse) {
            onProgress(key,'generating');
            const prompt=C.prompt(key,io.title(key),C.facts(bundle.activity),bundle.context,refs);
            const text=await io.generate(key,prompt,bundle,documentId);
            if(!String(text||'').trim()) throw new Error('AI chưa trả nội dung tài liệu.');
            savedResponse={documentId,key,prompt,result:text,dependencies:deps,inputHash:hash};
            // Preserve received output before attempting the database checkpoint.
            await io.buffer.put(documentId,savedResponse);
          } else onProgress(key,'saving');
          const beforeSave=await io.load(jobId);
          const currentHash=C.inputHash(key,beforeSave.hashes);
          const currentDocs=C.latest(beforeSave.documents);
          const currentRefs=Object.fromEntries(Object.entries(currentDocs).filter(([,d])=>C.reusable(d,beforeSave.hashes,currentDocs)));
          if(currentHash!==hash || C.stable(C.dependencies(key,currentRefs))!==C.stable(deps))
            throw new Error('Dữ kiện hoặc tài liệu tham chiếu đã đổi trong khi AI xử lý. Bấm tiếp tục để dùng bản mới.');
          await io.save(jobId,token,savedResponse);
          // Replays after a lost DB response use the same deterministic document UUID.
          await io.buffer.remove(documentId);
          onProgress(key,'saved');
        }
        completed=true;
      } catch(e) { errorText=e?.message||String(e); throw e; }
      finally { if(claimed) await io.release(jobId,token,completed,errorText).catch(e=>io.releaseWarning?.(e)); }
    }
    return {run};
  }
  return {create};
});
