
const cfg = window.APP_CONFIG || {};
function normalizeSupabaseUrl(v){
  let s=(v||"").trim().replace(/\/+$/,"");
  s=s.replace(/\/(rest|auth|storage)\/v1.*$/,"");
  return s;
}
const supabaseUrl=normalizeSupabaseUrl(cfg.SUPABASE_URL);
const configured=!!(supabaseUrl && cfg.SUPABASE_ANON_KEY);
const sb=configured ? supabase.createClient(supabaseUrl,cfg.SUPABASE_ANON_KEY.trim()) : null;
let currentUser=null, demo=!configured, editingScoreId=null;
const AI_FUNCTION_NAME=(cfg.AI_FUNCTION_NAME||"doi-ai").trim();
const $=s=>document.querySelector(s);
const pages={home:["Trang chủ","🏠"],plans:["Kế hoạch Đội","📅"],competition:["Thi đua lớp","🏆"],assembly:["Sinh hoạt dưới cờ","🎤"],radio:["Phát thanh măng non","🎙️"],assistant:["Trợ lý AI","🤖"]};

function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function showApp(user){currentUser=user;$("#loginScreen").classList.add("hidden");$("#appScreen").classList.remove("hidden");$("#userChip").textContent=demo?"Anh Tiến • Demo":(user?.email||"Đã đăng nhập");go("home");}
function showLogin(){$("#appScreen").classList.add("hidden");$("#loginScreen").classList.remove("hidden");}
async function init(){
 if(!configured){demo=true;showApp({email:"demo@local"});return;}
 try{const {data:{session},error}=await sb.auth.getSession();if(error)throw error;if(session)showApp(session.user);else showLogin();}
 catch(e){showLogin();$("#loginMsg").textContent="Lỗi cấu hình Supabase: "+e.message;}
}
$("#loginBtn").onclick=async()=>{if(!configured){demo=true;showApp({email:"demo@local"});return;}$("#loginMsg").textContent="Đang đăng nhập...";const {data,error}=await sb.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});if(error){$("#loginMsg").textContent="Không đăng nhập được: "+error.message;return;}$("#loginMsg").textContent="";showApp(data.user);};
$("#logoutBtn").onclick=async()=>{if(sb&&!demo)await sb.auth.signOut();showLogin();};
$("#menuBtn").onclick=()=>document.querySelector(".sidebar").classList.toggle("open");
document.addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)go(b.dataset.page);});

function go(p){$("#pageTitle").textContent=pages[p][0];document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("active",x.dataset.page===p));$("#content").innerHTML=render(p);document.querySelector(".sidebar").classList.remove("open");if(p==="plans")loadPlans();if(p==="competition"){bindScorePreview();loadScores();}
  if(["assembly","radio","assistant"].includes(p)) loadAIHistory(p);
}
function render(p){
 if(p==="home")return `<div class="hero"><h1>Xin chào Anh Tiến! 👋</h1><p>${demo?"App đang chạy Demo. Thi đua V1.2 vẫn hoạt động; để dùng AI thật của V1.3 cần cấu hình Supabase và Edge Function.":"Đã kết nối Supabase. V1.3 có AI thật cho Sinh hoạt dưới cờ, Phát thanh măng non và Trợ lý AI."}</p></div><div class="grid">${Object.entries(pages).filter(([k])=>k!=="home").map(([k,v])=>`<div class="card quick" data-page="${k}"><div class="emoji">${v[1]}</div><b>${v[0]}</b></div>`).join("")}</div>`;
 if(p==="plans")return `<div class="toolbar"><input id="planTitle" placeholder="Tên kế hoạch"><input id="planDate" type="date"><select id="planStatus"><option>Chưa thực hiện</option><option>Đang thực hiện</option><option>Hoàn thành</option></select><button class="btn primary" onclick="addPlan()">＋ Lưu kế hoạch</button></div><div id="planList" class="card list">Đang tải...</div>`;
 if(p==="competition")return `
 <div class="competition-head"><div><b>🏆 Bảng thi đua tuần</b><div class="muted">Nhập từng tiêu chí → tự tính tổng → xếp hạng tự động</div></div>
 <div class="filterbar"><label>Tuần <input id="filterWeek" type="number" min="1" max="53" value="1" style="width:75px"></label><button class="btn secondary" onclick="loadScores()">Xem</button><button class="btn secondary" onclick="exportCSV()">⬇ Xuất CSV</button></div></div>
 <div class="card">
  <div class="score-form">
   <div><label>Tuần *</label><input id="week" type="number" min="1" max="53" value="1"></div>
   <div><label>Lớp *</label><input id="className" list="classList" placeholder="Ví dụ: 4/3"><datalist id="classList">${classOptions()}</datalist></div>
   <div><label>Năm học</label><input id="schoolYear" value="2026-2027"></div>
   <div><label>Ngày ghi nhận</label><input id="scoreDate" type="date"></div>
   <div><label>Nề nếp</label><input class="score-part" id="discipline" type="number" step="0.5" value="0"></div>
   <div><label>Vệ sinh</label><input class="score-part" id="hygiene" type="number" step="0.5" value="0"></div>
   <div><label>Chuyên cần</label><input class="score-part" id="attendance" type="number" step="0.5" value="0"></div>
   <div><label>Đồng phục</label><input class="score-part" id="uniform" type="number" step="0.5" value="0"></div>
   <div><label>Phong trào</label><input class="score-part" id="movement" type="number" step="0.5" value="0"></div>
   <div><label>Điểm cộng</label><input class="score-part" id="bonus" type="number" step="0.5" value="0"></div>
   <div><label>Điểm trừ</label><input class="score-part" id="penalty" type="number" step="0.5" value="0"></div>
   <div><label>Tổng dự kiến</label><div id="totalPreview" class="total-preview">0 điểm</div></div>
   <div class="full"><label>Ghi chú / vi phạm / thành tích nổi bật</label><textarea id="scoreNotes" rows="2" placeholder="Ví dụ: +2 điểm phong trào; -1 điểm vệ sinh..."></textarea></div>
   <div class="full action-row"><button id="saveScoreBtn" class="btn primary" onclick="saveScore()">＋ Lưu điểm thi đua</button><button id="cancelEditBtn" class="btn secondary hidden" onclick="cancelScoreEdit()">Hủy chỉnh sửa</button></div>
  </div>
 </div>
 <div id="scoreStats" class="score-summary"></div>
 <div class="card table-wrap"><table><thead><tr><th>Hạng</th><th>Lớp</th><th>Nề nếp</th><th>Vệ sinh</th><th>Chuyên cần</th><th>Đồng phục</th><th>Phong trào</th><th>+ / −</th><th>Tổng</th><th>Thao tác</th></tr></thead><tbody id="scoreBody"><tr><td colspan="10">Đang tải...</td></tr></tbody></table></div>`;
 if(p==="assembly"||p==="radio")return `<div class="ai-layout"><div class="card ai-card"><h3>${p==="assembly"?"🎤 Soạn sinh hoạt dưới cờ":"🎙️ Soạn phát thanh măng non"}</h3><div class="field"><label>Chủ đề</label><input id="topic" value="${p==="assembly"?"An toàn giao thông":"Phòng chống đuối nước"}"></div><br><div class="field"><label>Thời lượng</label><select id="duration"><option>${p==="assembly"?"15 phút":"5 phút"}</option><option>10 phút</option><option>20 phút</option></select></div><br><div class="field"><label>Yêu cầu thêm</label><textarea id="extra" rows="4" placeholder="Ví dụ: có 3 câu hỏi tương tác, lời MC sinh động, phù hợp học sinh lớp 1–5..."></textarea></div><div class="privacy-note">🔐 Không nhập dữ liệu cá nhân nhạy cảm của học sinh. API key OpenAI không nằm trong trình duyệt.</div><div class="ai-actions"><button id="aiGenerateBtn" class="btn primary" onclick="generateAI('${p}')">✨ Tạo bằng AI thật</button><button class="btn secondary" onclick="copyAIResult('result')">📋 Sao chép</button></div><div id="aiStatus" class="ai-status"></div></div><div><div class="card"><div id="result" class="result">Nhập chủ đề rồi bấm “Tạo bằng AI thật”.</div></div><div class="card ai-history"><b>Lịch sử gần đây</b><div id="aiHistory">Đang tải...</div></div></div></div>`;
 if(p==="assistant")return `<div class="ai-layout"><div class="card ai-card"><h3>🤖 Trợ lý AI Công tác Đội</h3><div class="field"><label>Anh cần hỗ trợ nội dung gì?</label><textarea id="ask" rows="8" placeholder="Ví dụ: Soạn sinh hoạt dưới cờ tuần 6 về văn hóa ứng xử; gợi ý trò chơi tập thể; lập kế hoạch hoạt động Đội tháng 10..."></textarea></div><div class="privacy-note">🔐 Không gửi dữ liệu riêng tư không cần thiết của học sinh. Câu hỏi được chuyển qua backend Supabase rồi mới đến OpenAI.</div><div class="ai-actions"><button id="aiGenerateBtn" class="btn primary" onclick="generateAI('assistant')">Gửi Trợ lý AI</button><button class="btn secondary" onclick="copyAIResult('answer')">📋 Sao chép</button></div><div id="aiStatus" class="ai-status"></div></div><div><div class="card"><div id="answer" class="result">Em sẵn sàng hỗ trợ anh về kế hoạch, phong trào, sinh hoạt Đội/Sao, truyền thông, báo cáo và tổ chức hoạt động.</div></div><div class="card ai-history"><b>Lịch sử gần đây</b><div id="aiHistory">Đang tải...</div></div></div></div>`;
}
function classOptions(){let s="";for(let g=1;g<=5;g++)for(let c=1;c<=10;c++)s+=`<option value="${g}/${c}">`;return s;}
async function addPlan(){const item={title:$("#planTitle").value.trim(),plan_date:$("#planDate").value||null,status:$("#planStatus").value};if(!item.title)return alert("Anh nhập tên kế hoạch trước.");if(demo){const arr=JSON.parse(localStorage.getItem("plans")||"[]");arr.push({...item,id:crypto.randomUUID()});localStorage.setItem("plans",JSON.stringify(arr));loadPlans();return;}item.created_by=currentUser.id;const {error}=await sb.from("plans").insert(item);if(error)return alert(error.message);loadPlans();}
async function loadPlans(){let arr=[];if(demo)arr=JSON.parse(localStorage.getItem("plans")||"[]");else{const {data,error}=await sb.from("plans").select("*").order("plan_date",{ascending:true});if(error){$("#planList").textContent=error.message;return;}arr=data;}$("#planList").innerHTML=arr.length?arr.map(x=>`<div class="row"><div class="grow"><b>${esc(x.title)}</b><div class="meta">${esc(x.plan_date||"Chưa đặt ngày")}</div></div><span class="pill">${esc(x.status)}</span></div>`).join(""):`<div class="meta">Chưa có kế hoạch.</div>`;}

function num(id){return Number($(id)?.value||0);}
function calcFormTotal(){return num("#discipline")+num("#hygiene")+num("#attendance")+num("#uniform")+num("#movement")+num("#bonus")-num("#penalty");}
function bindScorePreview(){document.querySelectorAll(".score-part").forEach(x=>x.addEventListener("input",()=>{$("#totalPreview").textContent=calcFormTotal().toFixed(1).replace(".0","")+" điểm";}));const d=new Date();$("#scoreDate").value=d.toISOString().slice(0,10);}
function scoreTotal(x){return Number(x.final_total ?? (Number(x.discipline||0)+Number(x.hygiene||0)+Number(x.attendance||0)+Number(x.uniform||0)+Number(x.movement||0)+Number(x.bonus||0)-Number(x.penalty||0)));}
function formScore(){return {week_no:Number($("#week").value),class_name:$("#className").value.trim(),school_year:$("#schoolYear").value.trim()||"2026-2027",score_date:$("#scoreDate").value||null,discipline:num("#discipline"),hygiene:num("#hygiene"),attendance:num("#attendance"),uniform:num("#uniform"),movement:num("#movement"),bonus:num("#bonus"),penalty:num("#penalty"),notes:$("#scoreNotes").value.trim()};}
async function saveScore(){
 const item=formScore();if(!item.week_no||item.week_no<1)return alert("Anh nhập số tuần hợp lệ.");if(!item.class_name)return alert("Anh nhập tên lớp.");
 if(demo){let arr=JSON.parse(localStorage.getItem("scores_v12")||"[]");if(editingScoreId){arr=arr.map(x=>x.id===editingScoreId?{...x,...item,final_total:calcFormTotal()}:x);}else arr.push({...item,id:crypto.randomUUID(),final_total:calcFormTotal()});localStorage.setItem("scores_v12",JSON.stringify(arr));afterSaveScore();return;}
 item.created_by=currentUser.id;
 let q=editingScoreId?sb.from("competition_scores").update(item).eq("id",editingScoreId):sb.from("competition_scores").insert(item);
 const {error}=await q;if(error)return alert("Chưa lưu được: "+error.message+"\n\nNếu báo thiếu cột bonus/penalty/final_total, hãy chạy file V1.2-migration.sql trong Supabase.");afterSaveScore();
}
function afterSaveScore(){const w=$("#week").value;$("#filterWeek").value=w;cancelScoreEdit(false);loadScores();}
function cancelScoreEdit(clear=true){editingScoreId=null;$("#saveScoreBtn").textContent="＋ Lưu điểm thi đua";$("#cancelEditBtn").classList.add("hidden");if(clear){["#className","#scoreNotes"].forEach(id=>$(id).value="");["#discipline","#hygiene","#attendance","#uniform","#movement","#bonus","#penalty"].forEach(id=>$(id).value=0);$("#totalPreview").textContent="0 điểm";}}
let lastScores=[];
async function loadScores(){
 const week=Number($("#filterWeek")?.value||1);let arr=[];
 if(demo)arr=JSON.parse(localStorage.getItem("scores_v12")||"[]").filter(x=>Number(x.week_no)===week);
 else{const {data,error}=await sb.from("competition_scores").select("*").eq("week_no",week);if(error){$("#scoreBody").innerHTML=`<tr><td colspan="10">${esc(error.message)}</td></tr>`;return;}arr=data||[];}
 arr.sort((a,b)=>scoreTotal(b)-scoreTotal(a)||String(a.class_name).localeCompare(String(b.class_name),"vi"));lastScores=arr;
 const top=arr[0];const avg=arr.length?arr.reduce((s,x)=>s+scoreTotal(x),0)/arr.length:0;
 $("#scoreStats").innerHTML=`<div class="stat"><small>Tuần đang xem</small><b>${week}</b></div><div class="stat"><small>Số lớp đã nhập</small><b>${arr.length}</b></div><div class="stat"><small>Dẫn đầu</small><b>${top?esc(top.class_name):"—"}</b></div><div class="stat"><small>Điểm trung bình</small><b>${avg?avg.toFixed(1):"—"}</b></div>`;
 $("#scoreBody").innerHTML=arr.length?arr.map((x,i)=>`<tr><td class="${i===0?"rank1":""}">${i===0?"🥇 ":i===1?"🥈 ":i===2?"🥉 ":""}${i+1}</td><td><b>${esc(x.class_name)}</b><div class="muted">${esc(x.notes||"")}</div></td><td>${x.discipline||0}</td><td>${x.hygiene||0}</td><td>${x.attendance||0}</td><td>${x.uniform||0}</td><td>${x.movement||0}</td><td>+${x.bonus||0} / −${x.penalty||0}</td><td><span class="badge-good"><b>${scoreTotal(x)}</b></span></td><td><div class="action-row"><button class="btn secondary" onclick='editScore(${JSON.stringify(JSON.stringify(x))})'>Sửa</button><button class="btn danger" onclick="deleteScore('${x.id}')">Xóa</button></div></td></tr>`).join(""):`<tr><td colspan="10">Tuần ${week} chưa có dữ liệu thi đua.</td></tr>`;
}
function editScore(raw){const x=JSON.parse(raw);editingScoreId=x.id;$("#week").value=x.week_no;$("#className").value=x.class_name;$("#schoolYear").value=x.school_year||"2026-2027";$("#scoreDate").value=x.score_date||"";["discipline","hygiene","attendance","uniform","movement","bonus","penalty"].forEach(k=>$("#"+k).value=x[k]||0);$("#scoreNotes").value=x.notes||"";$("#totalPreview").textContent=scoreTotal(x)+" điểm";$("#saveScoreBtn").textContent="💾 Cập nhật điểm";$("#cancelEditBtn").classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"});}
async function deleteScore(id){if(!confirm("Xóa bản ghi thi đua này?"))return;if(demo){let arr=JSON.parse(localStorage.getItem("scores_v12")||"[]").filter(x=>x.id!==id);localStorage.setItem("scores_v12",JSON.stringify(arr));loadScores();return;}const {error}=await sb.from("competition_scores").delete().eq("id",id);if(error)return alert(error.message);loadScores();}
function csvCell(v){return `"${String(v??"").replace(/"/g,'""')}"`;}
function exportCSV(){if(!lastScores.length)return alert("Chưa có dữ liệu để xuất.");const rows=[["Hạng","Lớp","Tuần","Nề nếp","Vệ sinh","Chuyên cần","Đồng phục","Phong trào","Điểm cộng","Điểm trừ","Tổng","Ghi chú"],...lastScores.map((x,i)=>[i+1,x.class_name,x.week_no,x.discipline,x.hygiene,x.attendance,x.uniform,x.movement,x.bonus||0,x.penalty||0,scoreTotal(x),x.notes||""])];const csv="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`thi-dua-tuan-${$("#filterWeek").value}.csv`;a.click();URL.revokeObjectURL(a.href);}
async function generateAI(module){
 if(demo||!sb)return alert("Để dùng AI thật, anh cần cấu hình Supabase và đăng nhập trước.");
 const outputId=module==="assistant"?"answer":"result";
 const out=$("#"+outputId), btn=$("#aiGenerateBtn"), status=$("#aiStatus");
 let body={module}; let promptForHistory="";
 if(module==="assistant"){
   const prompt=$("#ask").value.trim(); if(!prompt)return alert("Anh nhập câu hỏi trước.");
   body.prompt=prompt; promptForHistory=prompt;
 }else{
   const topic=$("#topic").value.trim(); if(!topic)return alert("Anh nhập chủ đề trước.");
   body.topic=topic; body.duration=$("#duration").value; body.extra=$("#extra").value.trim();
   promptForHistory=`Chủ đề: ${topic}; Thời lượng: ${body.duration}${body.extra?`; Yêu cầu thêm: ${body.extra}`:""}`;
 }
 btn.disabled=true; status.textContent="AI đang soạn nội dung..."; out.textContent="Đang tạo...";
 try{
   const {data,error}=await sb.functions.invoke(AI_FUNCTION_NAME,{body});
   if(error)throw error;
   if(data?.error)throw new Error(data.error);
   const text=data?.text||""; if(!text)throw new Error("AI chưa trả về nội dung.");
   out.textContent=text; status.textContent=`Đã tạo bằng ${data.model||"OpenAI"}.`;
   const {error:historyError}=await sb.from("ai_history").insert({module,prompt:promptForHistory,result:text,created_by:currentUser.id});
   if(historyError)status.textContent += " Chưa lưu được lịch sử: "+historyError.message;
   else loadAIHistory(module);
 }catch(e){out.textContent="Chưa tạo được nội dung.";status.textContent="Lỗi: "+(e?.message||e);}
 finally{btn.disabled=false;}
}
async function loadAIHistory(module){
 const box=$("#aiHistory"); if(!box)return;
 if(demo){box.innerHTML='<div class="muted">Lịch sử AI chỉ lưu khi đã kết nối Supabase.</div>';return;}
 const {data,error}=await sb.from("ai_history").select("id,module,prompt,result,created_at").eq("module",module).order("created_at",{ascending:false}).limit(5);
 if(error){box.textContent=error.message;return;}
 box.innerHTML=data?.length?data.map(x=>`<div class="history-item"><b>${new Date(x.created_at).toLocaleString("vi-VN")}</b><div class="muted">${esc(x.prompt)}</div><div class="history-result">${esc(x.result)}</div></div>`).join(""):'<div class="muted">Chưa có lịch sử.</div>';
}
async function copyAIResult(id){const text=$("#"+id)?.textContent||"";if(!text)return;try{await navigator.clipboard.writeText(text);alert("Đã sao chép nội dung.");}catch{alert("Trình duyệt không cho sao chép tự động. Anh bôi đen nội dung và nhấn Ctrl+C.");}}
init();
