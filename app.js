const defaultQuestions = [
  ["reflection", "What's been taking up more of your mental space than it deserves?"],
  ["focus", "What's the one thing worth making progress on today?"],
  ["self-awareness", "What are you avoiding right now?"],
  ["life", "What could you make slightly easier for yourself today?"],
  ["decision", "What decision are you making harder than it needs to be?"],
  ["reflection", "What's been quietly bothering you lately?"],
  ["focus", "If you could only finish one thing today, what should it be?"],
  ["growth", "What's something you're currently learning about yourself?"],
  ["relationships", "Who would you genuinely like to hear from today?"],
  ["attention", "What are you about to spend time on, and is it worth it?"],
  ["future", "What would future-you thank you for starting today?"],
  ["creativity", "What would you make if nobody else ever saw it?"],
  ["well-being", "What would make tonight feel like a good night?"],
  ["reflection", "What's something that went better than expected recently?"],
  ["growth", "What mistake taught you something useful?"],
  ["life", "What are you tolerating that you don't actually need to tolerate?"],
  ["focus", "What's the smallest useful step you could take right now?"],
  ["decision", "What are you waiting for permission to do?"],
  ["relationships", "Is there someone you should thank?"],
  ["learning", "What's something you changed your mind about recently?"],
  ["attention", "Where has your attention been going lately?"],
  ["future", "What do you want more of in your life six months from now?"],
  ["reflection", "What are you proud of that you don't talk about much?"],
  ["self-awareness", "What usually happens right before you procrastinate?"],
  ["life", "What can you stop doing without anything important breaking?"],
  ["growth", "Where are you expecting yourself to be perfect?"],
  ["fun", "If today had a theme, what would it be?"],
  ["curiosity", "What's something you've been curious about lately?"],
  ["well-being", "What does your body probably need today?"],
  ["reflection", "What did yesterday teach you?"],
  ["focus", "What deserves your full attention today?"],
  ["decision", "What would you choose if you weren't worried about disappointing anyone?"],
  ["relationships", "Who makes your life better just by being around?"],
  ["future", "What small thing could you start today that compounds over time?"],
  ["life", "What's something you have enough of already?"],
  ["self-awareness", "What story have you been telling yourself lately?"],
  ["creativity", "What idea keeps coming back to you?"],
  ["learning", "What do you wish you understood better?"],
  ["attention", "What's one distraction you could remove today?"],
  ["reflection", "What's something you want to remember about this period of your life?"]
];

const DEFAULT_FOCUS_QUESTIONS = [
  "What do you want to move forward right now?",
  "What would make the next hour feel worthwhile?",
  "What is the most useful thing you can do in the next 20 minutes?",
  "What are you choosing to give your attention to right now?",
  "What small action would create momentum?",
  "What needs to happen before you can call today a good day?",
  "If you stopped optimizing, what would you simply do next?",
  "What deserves your attention more than the thing distracting you?"
];

const extensionStorage=(typeof browser!=="undefined"&&browser.storage&&browser.storage.local)
  ? browser.storage.local
  : null;
const STORAGE_KEYS=[
  "oneQuestionQuestionBank","oneQuestionFocusQuestions","oneQuestionSettings",
  "oneQuestionHistory","oneQuestionRecent","oneQuestionTodos"
];

function cacheSet(key,value){
  try{localStorage.setItem(key,JSON.stringify(value))}catch(e){console.warn("One Question: local cache write failed",e)}
  if(extensionStorage){
    extensionStorage.set({[key]:value}).catch(e=>console.warn("One Question: browser storage write failed",e));
  }
}
function readCached(key,fallback){
  try{
    const raw=localStorage.getItem(key);
    return raw===null?fallback:JSON.parse(raw);
  }catch{return fallback}
}
async function hydrateBrowserStorage(){
  if(!extensionStorage)return;
  try{
    const data=await extensionStorage.get(STORAGE_KEYS);
    let changed=false;
    for(const key of STORAGE_KEYS){
      if(Object.prototype.hasOwnProperty.call(data,key)){
        try{localStorage.setItem(key,JSON.stringify(data[key]))}catch{}
      }else{
        const cached=readCached(key,null);
        if(cached!==null){
          await extensionStorage.set({[key]:cached});
          changed=true;
        }
      }
    }
    if(changed) setDataStatus("storage: migrated existing data to browser extension storage");
    else setDataStatus("storage: browser extension storage");
  }catch(e){
    console.warn("One Question: browser storage could not be read",e);
    setDataStatus("storage: local fallback (browser storage unavailable)");
  }
}
function setDataStatus(text){
  const el=document.getElementById("dataStatus");
  if(el)el.textContent=text;
}

function loadQuestionBank(){
  try{
    const saved=JSON.parse(localStorage.getItem("oneQuestionQuestionBank")||"null");
    if(Array.isArray(saved)&&saved.length){
      return saved.filter(x=>Array.isArray(x)&&x.length>=2&&typeof x[0]==="string"&&typeof x[1]==="string"&&x[1].trim()).map(x=>[x[0],x[1].trim()]);
    }
    if(saved&&typeof saved==="object"){
      return defaultQuestions.map((q,i)=>[q[0],typeof saved[i]==="string"&&saved[i].trim()?saved[i].trim():q[1]]);
    }
  }catch{}
  return defaultQuestions.slice();
}
function saveQuestionBank(){cacheSet("oneQuestionQuestionBank",questions)}

function loadFocusQuestions(){
  try{
    const saved=JSON.parse(localStorage.getItem("oneQuestionFocusQuestions")||"null");
    if(Array.isArray(saved)&&saved.length)return saved.filter(x=>typeof x==="string"&&x.trim()).map(x=>x.trim());
  }catch{}
  return DEFAULT_FOCUS_QUESTIONS.slice();
}
function saveFocusQuestions(){cacheSet("oneQuestionFocusQuestions",focusQuestions)}

let questions=loadQuestionBank();
let focusQuestions=loadFocusQuestions();
let focusIndex=null;

const $=id=>document.getElementById(id);
const questionEl=$("question"),categoryEl=$("category"),answerEl=$("answer"),focusEl=$("focus");
const dateEl=$("date"),cycleStatus=$("cycleStatus");

// Wallpaper Engine Web wallpapers cannot receive normal keyboard input inside
// the wallpaper. Use native user properties instead. The project.json file
// exposes a real textinput for the answer and sliders for parallax settings.
let wallpaperEngineProperties = {};
function applyWallpaperEngineProperties(properties){
  if(!properties) return;
  wallpaperEngineProperties={...wallpaperEngineProperties,...properties};

  if(properties.answer){
    const value=String(properties.answer.value ?? "");
    answerEl.textContent=value;
    isAnswering=!!value;
  }
  if(properties.text_parallax){
    settings.appearance.parallaxText=Number(properties.text_parallax.value);
  }
  if(properties.background_parallax){
    settings.appearance.parallaxBackground=Number(properties.background_parallax.value);
  }
  if(properties.background_scale){
    settings.appearance.parallaxScale=Number(properties.background_scale.value);
  }
  if(properties.question_cycle){
    settings.cycleSeconds=Math.max(3,Number(properties.question_cycle.value)||6.5);
  }

  saveSettings();
  applyAppearance();
  applyParallax(parallaxPointerX,parallaxPointerY);
  updateCycleToggle();
}
window.wallpaperPropertyListener={applyUserProperties:applyWallpaperEngineProperties};

let currentIndex=null,currentQuestion=null,cycleTimer=null,isAnswering=false,cyclePaused=false;
let currentMode="question",returnMode="question";
let historyIndex=0,historyReturnMode="question";
let viewedQuestions=[],viewedPosition=-1;

const DEFAULT_APPEARANCE={
  backgroundColor:"#10100f",
  textColor:"#ebe8e0",
  accentColor:"#aaa69d",
  overlayColor:"#10100f",
  overlayOpacity:30,
  backgroundOpacity:35,
  backgroundImage:"",
  backgroundFileName:"",
  blur:0,
  grayscale:0,
  saturation:100,
  brightness:100,
  contrast:100,
  sepia:0,
  parallaxText:10,
  parallaxBackground:18,
  parallaxScale:108
};
const DEFAULT_SETTINGS={categories:["all"],cycleSeconds:6.5,animation:true,appearance:{...DEFAULT_APPEARANCE}};
let settings=loadSettings();

function loadSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem("oneQuestionSettings")||"{}");
    const categories=Array.isArray(saved.categories)&&saved.categories.length?saved.categories:["all"];
    return {...DEFAULT_SETTINGS,...saved,categories,appearance:{...DEFAULT_APPEARANCE,...(saved.appearance||{})}};
  }catch{return {...DEFAULT_SETTINGS,appearance:{...DEFAULT_APPEARANCE}}}
}
function saveSettings(){cacheSet("oneQuestionSettings",settings)}
function selectedCategories(){return settings.categories.includes("all")?new Set(uniqueCategories()):new Set(settings.categories)}
function uniqueCategories(){return [...new Set(questions.map(q=>q[0]))].sort((a,b)=>a.localeCompare(b))}
const todayKey=()=>new Date().toLocaleDateString("en-CA");
function dateKeyFromDate(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate(),12).toLocaleDateString("en-CA")}
let calendarMonthDate=new Date();
let calendarSelectedDate=todayKey();
let todoViewDate=todayKey();
let todoViewScope="date";
const getHistory=()=>{try{return JSON.parse(localStorage.getItem("oneQuestionHistory")||"[]")}catch{return[]}};
const saveHistory=x=>cacheSet("oneQuestionHistory",x);
const getRecent=()=>{try{return JSON.parse(localStorage.getItem("oneQuestionRecent")||"[]")}catch{return[]}};
const saveRecent=x=>cacheSet("oneQuestionRecent",x);
const getTodos=()=>{try{return JSON.parse(localStorage.getItem("oneQuestionTodos")||"[]")}catch{return[]}};
const saveTodos=x=>cacheSet("oneQuestionTodos",x);

function availableIndices(){
  const cats=selectedCategories();
  return questions.map((q,i)=>({q,i})).filter(x=>cats.has(x.q[0])).map(x=>x.i);
}
function chooseFreshIndex(){
  const pool=availableIndices();
  if(!pool.length)return 0;
  const recent=getRecent().filter(i=>pool.includes(i));
  const available=pool.filter(i=>!recent.includes(i));
  const source=available.length?available:pool;
  return source[Math.floor(Math.random()*source.length)];
}
function categoryLabel(){
  if(settings.categories.includes("all"))return "all";
  if(settings.categories.length===1)return settings.categories[0];
  return `${settings.categories[0]} + ${settings.categories.length-1}`;
}
function remember(i){
  viewedQuestions=viewedQuestions.slice(0,viewedPosition+1);
  viewedQuestions.push(i);
  viewedPosition=viewedQuestions.length-1;
}
function rememberRecent(i){
  const r=getRecent().filter(x=>x!==i);
  r.push(i);
  saveRecent(r.slice(-12));
}
function setCycleStatus(text,active=false){
  cycleStatus.textContent=text;
  cycleStatus.classList.toggle("cycling",active);
}
function updateCycleToggle(){
  const btn=$("cycleToggle");
  if(!btn)return;
  const active=(currentMode==="question"||currentMode==="focus")&&!cyclePaused&&!isAnswering;
  btn.classList.toggle("paused",!active);
  btn.classList.toggle("isCycling",active);
  btn.classList.toggle("isPaused",!active);
  btn.setAttribute("aria-label",active?"Pause question cycling":"Continue question cycling");
  btn.setAttribute("title",active?"Pause question cycling":"Continue question cycling");
}
function updateModeUI(){
  const label=currentMode==="focus"?"focus mode":"question mode";
  const btn=$("modeToggle");
  if(btn){
    btn.textContent=label;
    btn.classList.toggle("active",currentMode==="focus");
    btn.setAttribute("aria-pressed",String(currentMode==="focus"));
  }
  document.body.classList.toggle("todayMode",currentMode==="today");
}
function closeModeMenu(){}
function toggleModeMenu(){
  if(currentMode==="question") enterFocusMode();
  else if(currentMode==="focus") enterQuestionMode();
}
function renderQuestion(i){
  currentIndex=i;
  currentQuestion=questions[i];
  categoryEl.textContent=categoryLabel();
  questionEl.textContent=currentQuestion[1];
  answerEl.textContent="";
  updateFocusUI();
}
function showQuestion(i,rememberIt=true){
  if(currentMode!=="question")return;
  clearTimeout(cycleTimer);
  focusEl.classList.remove("questionIn");
  focusEl.classList.add("questionOut");
  const delay=settings.animation?390:0;
  setTimeout(()=>{
    if(currentMode!=="question")return;
    renderQuestion(i);
    if(rememberIt)remember(i);
    rememberRecent(i);
    focusEl.classList.remove("questionOut");
    void focusEl.offsetWidth;
    focusEl.classList.add("questionIn");
    setTimeout(()=>focusEl.classList.remove("questionIn"),1100);
    startCycle();
  },delay);
}
function chooseFreshFocusIndex(){
  if(!focusQuestions.length)return 0;
  if(focusQuestions.length===1)return 0;
  let next=Math.floor(Math.random()*focusQuestions.length);
  if(next===focusIndex)next=(next+1)%focusQuestions.length;
  return next;
}
function renderFocusQuestion(i){
  if(!focusQuestions.length)return;
  focusIndex=Math.max(0,Math.min(i,focusQuestions.length-1));
  currentQuestion=["focus mode",focusQuestions[focusIndex]];
  categoryEl.textContent="focus mode";
  questionEl.textContent=currentQuestion[1];
  answerEl.textContent="";
  updateFocusUI();
}
function showFocusQuestion(i){
  clearTimeout(cycleTimer);
  if(currentMode!=="focus")return;
  focusEl.classList.remove("questionIn");
  focusEl.classList.add("questionOut");
  const delay=settings.animation?390:0;
  setTimeout(()=>{
    if(currentMode!=="focus")return;
    renderFocusQuestion(i);
    focusEl.classList.remove("questionOut");
    void focusEl.offsetWidth;
    focusEl.classList.add("questionIn");
    setTimeout(()=>focusEl.classList.remove("questionIn"),1100);
    startCycle();
  },delay);
}

function startCycle(){
  clearTimeout(cycleTimer);
  if(currentMode==="today"){
    setCycleStatus("today",false);updateCycleToggle();return;
  }
  if(cyclePaused){setCycleStatus("paused",false);updateCycleToggle();return;}
  if(isAnswering){setCycleStatus("answering",false);updateCycleToggle();return;}
  setCycleStatus("cycling",true);updateCycleToggle();
  const seconds=Math.max(1,Number(settings.cycleSeconds)||6.5);
  cycleTimer=setTimeout(()=>{
    if((currentMode==="question"||currentMode==="focus")&&!cyclePaused&&!isAnswering){
      if(currentMode==="focus")showFocusQuestion(chooseFreshFocusIndex());
      else showQuestion(chooseFreshIndex());
    }
  },seconds*1000);
}
function nextQuestion(){
  if(currentMode==="focus"){
    isAnswering=false;showFocusQuestion(chooseFreshFocusIndex());return;
  }
  if(currentMode!=="question")return;
  isAnswering=false;showQuestion(chooseFreshIndex());
}
function previousQuestion(){
  if(currentMode==="focus"){
    isAnswering=false;
    if(focusQuestions.length>1)showFocusQuestion((focusIndex-1+focusQuestions.length)%focusQuestions.length);
    return;
  }
  if(currentMode!=="question"||viewedPosition<=0)return;
  isAnswering=false;clearTimeout(cycleTimer);viewedPosition--;showQuestion(viewedQuestions[viewedPosition],false);
}
function toggleCycle(){
  if(currentMode!=="question"&&currentMode!=="focus")return;
  if(cyclePaused){cyclePaused=false;isAnswering=false;startCycle();}
  else{cyclePaused=true;clearTimeout(cycleTimer);startCycle();}
}
function beginAnswering(){
  if(currentMode==="question"){
    isAnswering=true;
    clearTimeout(cycleTimer);
    setCycleStatus("answering",false);
    updateCycleToggle();
  }
}
function saveAnswer(){
  const text=answerEl.innerText.trim();
  if(!text){answerEl.focus();return}
  if(currentMode==="focus"){
    addTodoText(text);
    answerEl.textContent="";
    isAnswering=false;
    updateFocusUI();
    showFocusQuestion(chooseFreshFocusIndex());
    answerEl.focus();
    return;
  }
  if(currentMode!=="question")return;
  const h=getHistory();
  h.unshift({question:currentQuestion[1],category:currentQuestion[0],answer:text,date:new Date().toISOString(),answeredAt:new Date().toISOString()});
  saveHistory(h);
  isAnswering=false;
  nextQuestion();
}

function formatTodoTime(iso){
  const d=new Date(iso);
  return Number.isNaN(d.getTime())?"":d.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
}
function formatTodoDate(key,long=false){
  const d=new Date(`${key}T12:00:00`);
  return Number.isNaN(d.getTime())?key:d.toLocaleDateString(undefined,long?{weekday:"long",month:"long",day:"numeric",year:"numeric"}:{month:"long",day:"numeric",year:"numeric"});
}
function todosForDate(key){return getTodos().filter(t=>t.date===key)}
function renderTodos(dateKey=todoViewDate||todayKey()){
  todoViewDate=dateKey;
  const today=todayKey();
  const upcoming=todoViewScope==="upcoming";
  const dateTodos=todosForDate(dateKey);
  const remainingToday=getTodos().filter(t=>t.date===today&&!t.completed).length;
  const count=$("todoDockCount"); if(count)count.textContent=remainingToday;
  const dock=$("todoDock"); if(dock)dock.setAttribute("aria-label",`${remainingToday} unfinished todo${remainingToday===1?"":"s"}`);
  const list=$("todoFullscreenList"); if(!list)return;
  list.textContent="";
  const addGroup=(items,isDone)=>{
    items.forEach(t=>{
      const row=document.createElement("div");row.className="fullscreenTodo"+(isDone?" completed":"");
      const check=document.createElement("button");check.type="button";check.className="fullscreenTodoCheck";
      check.setAttribute("aria-label",isDone?"Mark todo as unfinished":"Mark todo complete");
      check.onclick=()=>{const a=getTodos(),x=a.find(y=>y.id===t.id);if(x){x.completed=!x.completed;x.completedAt=x.completed?new Date().toISOString():null}saveTodos(a);renderTodos(todoViewDate);renderCalendar();};
      const body=document.createElement("div");body.className="fullscreenTodoBody";
      const txt=document.createElement("div");txt.className="fullscreenTodoText";txt.textContent=t.text;
      const time=document.createElement("div");time.className="fullscreenTodoTime";time.textContent=t.createdAt?`added ${formatTodoTime(t.createdAt)}`:"added";
      body.append(txt,time);
      if(isDone&&t.completedAt){const done=document.createElement("div");done.className="fullscreenTodoCompletedTime";done.textContent=`completed ${formatTodoTime(t.completedAt)}`;body.append(done);}
      const del=document.createElement("button");del.type="button";del.className="fullscreenTodoDelete";del.textContent="×";del.setAttribute("aria-label","Delete todo");
      del.onclick=()=>{saveTodos(getTodos().filter(x=>x.id!==t.id));renderTodos(todoViewDate);renderCalendar();};
      row.append(check,body,del);list.append(row);
    });
  };
  let groups=[];
  if(upcoming){
    const futureKeys=[...new Set(getTodos().filter(t=>!t.completed&&t.date>=today).map(t=>t.date))].sort();
    groups=futureKeys.map(key=>({key,items:getTodos().filter(t=>!t.completed&&t.date===key)}));
    groups.forEach(g=>{
      const groupHeading=document.createElement("div");groupHeading.className="todoDateGroupHeading";groupHeading.textContent=g.key===today?"Today":formatTodoDate(g.key,true);list.append(groupHeading);
      addGroup(g.items,false);
    });
  }else{
    const unfinished=dateTodos.filter(t=>!t.completed),completed=dateTodos.filter(t=>t.completed);
    groups=[{key:dateKey,items:dateTodos}];
    addGroup(unfinished,false);
    if(completed.length){const divider=document.createElement("div");divider.className="completedDivider";divider.textContent="completed";list.append(divider);addGroup(completed,true);}
  }
  const hasItems=groups.some(g=>g.items.length);
  const empty=$("todoFullscreenEmpty");if(empty){empty.hidden=hasItems;empty.textContent=upcoming?"nothing upcoming yet.":"nothing here yet.";}
  const kicker=$("todoFullscreenKicker");if(kicker)kicker.textContent=upcoming?"upcoming":(dateKey===today?"today":"scheduled");
  const dateHeading=$("todoFullscreenDate");if(dateHeading)dateHeading.textContent=formatTodoDate(dateKey,true);
  const heading=document.querySelector("#todoFullscreen h2");if(heading)heading.textContent=upcoming||dateKey===today?"What needs your attention?":"What needs your attention on this day?";
}
function renderCalendar(){
  const grid=$("calendarGrid"),month=$("calendarMonth");if(!grid||!month)return;
  const y=calendarMonthDate.getFullYear(),m=calendarMonthDate.getMonth();
  month.textContent=calendarMonthDate.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  grid.textContent="";
  const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay()),allTodos=getTodos();
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const key=dateKeyFromDate(d);
    const btn=document.createElement("button");btn.type="button";btn.className="calendarDay";btn.setAttribute("role","gridcell");
    if(d.getMonth()!==m)btn.classList.add("muted");
    if(key===todayKey())btn.classList.add("today");
    if(key===calendarSelectedDate)btn.classList.add("selected");
    const dayTodos=allTodos.filter(t=>t.date===key);
    if(dayTodos.length)btn.classList.add("hasTodos");
    const num=document.createElement("span");num.className="calendarDayNumber";num.textContent=String(d.getDate());btn.append(num);
    if(dayTodos.length){const dot=document.createElement("span");dot.className="calendarDot";dot.setAttribute("aria-hidden","true");btn.append(dot);}
    btn.title=dayTodos.length?`${dayTodos.length} todo${dayTodos.length===1?"":"s"}`:formatTodoDate(key);
    btn.onclick=()=>openDateTodos(key);grid.append(btn);
  }
}
function toggleCalendar(){
  const panel=$("calendarPanel");if(!panel)return;
  const open=!panel.classList.contains("open");panel.classList.toggle("open",open);panel.setAttribute("aria-hidden",String(!open));$("date").setAttribute("aria-expanded",String(open));
  if(open){const selected=new Date(`${calendarSelectedDate}T12:00:00`);if(!Number.isNaN(selected.getTime()))calendarMonthDate=new Date(selected.getFullYear(),selected.getMonth(),1);renderCalendar();}
}
function closeCalendar(){const panel=$("calendarPanel");if(!panel)return;panel.classList.remove("open");panel.setAttribute("aria-hidden","true");$("date").setAttribute("aria-expanded","false");}
function openDateTodos(key){
  calendarSelectedDate=key;closeCalendar();clearTimeout(cycleTimer);todoViewDate=key;todoViewScope="date";if(currentMode!=="today")returnMode=currentMode;currentMode="today";closeModeMenu();updateModeUI();renderTodos(key);
  const screen=$("todoFullscreen");screen.classList.add("open");screen.setAttribute("aria-hidden","false");setCycleStatus(key===todayKey()?"today":"scheduled",false);setTimeout(()=>$("todoFullscreenInput").focus(),80);
}

function addTodoText(text,dateKey=todoViewDate||todayKey()){
  const clean=String(text||"").trim();
  if(!clean)return false;
  const a=getTodos();
  a.unshift({id:crypto.randomUUID(),text:clean,completed:false,date:dateKey,createdAt:new Date().toISOString(),completedAt:null});
  saveTodos(a);
  renderTodos(todoViewDate);
  renderCalendar();
  const dock=$("todoDock");
  if(dock){
    dock.classList.remove("hasNew");
    void dock.offsetWidth;
    dock.classList.add("hasNew");
  }
  return true;
}
function openToday(){
  clearTimeout(cycleTimer);
  todoViewDate=todayKey();
  todoViewScope="upcoming";
  if(currentMode!=="today")returnMode=currentMode;
  currentMode="today";
  todoViewDate=todayKey();
  calendarSelectedDate=todayKey();
  closeModeMenu();
  updateModeUI();
  renderTodos(todoViewDate);
  const screen=$("todoFullscreen");
  screen.classList.add("open");
  screen.setAttribute("aria-hidden","false");
  setCycleStatus("today",false);
  setTimeout(()=>{$("todoFullscreenInput").focus()},80);
}
function closeToday(){
  todoViewScope="date";
  const screen=$("todoFullscreen");
  screen.classList.remove("open");
  screen.setAttribute("aria-hidden","true");
  $("todoFullscreenInput").value="";
  currentMode=returnMode||"question";
  returnMode="question";
  updateModeUI();

  if(currentMode==="focus"){
    isAnswering=false;
    cyclePaused=true;
    showFocusQuestion(chooseFreshFocusIndex());
    answerEl.focus();
  }else{
    isAnswering=false;
    cyclePaused=false;
    showQuestion(chooseFreshIndex());
  }
}
function addFullscreenTodo(){
  const input=$("todoFullscreenInput");
  if(!input)return;
  if(addTodoText(input.value,todoViewDate||todayKey())){
    input.value="";
    input.focus();
  }
}
function renderHistoryEntry(animate=true){
  const h=getHistory();
  const panel=$("historyPanel");
  if(!h.length){
    $("historyCategory").textContent="";
    $("historyQuestion").textContent="Nothing here yet.";
    $("historyQuestion").classList.add("historyEmpty");
    $("historyAnswer").textContent="Answer a question and it will live here.";
    $("historyDate").textContent="";
    $("historyPosition").textContent="";
    $("historyPrevious").disabled=true;
    $("historyNext").disabled=true;
    return;
  }
  historyIndex=Math.max(0,Math.min(historyIndex,h.length-1));
  const x=h[historyIndex];
  const q=$("historyQuestion");
  const answer=$("historyAnswer");
  if(animate){
    q.style.opacity="0";answer.style.opacity="0";
    q.style.transform="translateY(10px)";answer.style.transform="translateY(8px)";
    setTimeout(()=>{
      if(!$("historyPanel").classList.contains("open"))return;
      q.style.transition="opacity .45s ease,transform .55s cubic-bezier(.2,.7,.2,1)";
      answer.style.transition="opacity .45s ease .08s,transform .55s cubic-bezier(.2,.7,.2,1) .08s";
      q.style.opacity="1";q.style.transform="none";
      answer.style.opacity="1";answer.style.transform="none";
    },20);
  }else{q.style.opacity="1";answer.style.opacity="1";q.style.transform="none";answer.style.transform="none";}
  q.classList.remove("historyEmpty");
  $("historyCategory").textContent=x.category||"reflection";
  q.textContent=x.question||"";
  answer.textContent=x.answer||"";
  const d=new Date(x.answeredAt||x.date);
  $("historyDate").textContent=Number.isNaN(d.getTime())?"":`answered ${d.toLocaleString()}`;
  $("historyPosition").textContent=`${historyIndex+1} / ${h.length}`;
  $("historyPrevious").disabled=historyIndex<=0;
  $("historyNext").disabled=historyIndex>=h.length-1;
}
function showHistory(){
  clearTimeout(cycleTimer);
  historyReturnMode=currentMode;
  currentMode="history";
  historyIndex=0;
  closeModeMenu();
  document.body.classList.add("historyOpen");
  const panel=$("historyPanel");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden","false");
  renderHistoryEntry(false);
}
function closeHistory(){
  const panel=$("historyPanel");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden","true");
  document.body.classList.remove("historyOpen");
  currentMode=historyReturnMode||"question";
  historyReturnMode="question";
  updateModeUI();
  updateFocusUI();
  if(currentMode==="focus"){showFocusQuestion(chooseFreshFocusIndex());answerEl.focus();}
  else if(currentMode==="question"){showQuestion(chooseFreshIndex());}
}
function historyPrevious(){
  const h=getHistory();if(!h.length||historyIndex<=0)return;
  historyIndex--;renderHistoryEntry(true);
}
function historyNext(){
  const h=getHistory();if(!h.length||historyIndex>=h.length-1)return;
  historyIndex++;renderHistoryEntry(true);
}
let editorCategory="";
function getEditorCategories(){return uniqueCategories();}
function renderQuestionEditor(){
  const tabs=$("questionEditorTabs"),body=$("questionEditor");
  if(!tabs||!body)return;
  const cats=[...getEditorCategories(),"focus mode"];
  if(!editorCategory||!cats.includes(editorCategory))editorCategory=cats[0]||"focus mode";
  tabs.innerHTML="";
  cats.forEach(cat=>{
    const b=document.createElement("button");b.type="button";b.className="questionEditorTab"+(cat===editorCategory?" active":"");b.textContent=cat;
    b.onclick=()=>{editorCategory=cat;renderQuestionEditor()};tabs.append(b);
  });
  body.innerHTML="";
  if(editorCategory==="focus mode"){
    focusQuestions.forEach((q,i)=>addEditorRow(body,q,value=>{focusQuestions[i]=value;saveFocusQuestions()}));
    addEditorAddButton(body,()=>{focusQuestions.push("New focus question?");saveFocusQuestions();renderQuestionEditor()});
    return;
  }
  const indices=questions.map((q,i)=>({q,i})).filter(x=>x.q[0]===editorCategory);
  indices.forEach(({q,i})=>addEditorRow(body,q[1],value=>{questions[i][1]=value;saveQuestionBank()}));
  addEditorAddButton(body,()=>{
    const text=`New ${editorCategory} question?`;
    questions.push([editorCategory,text]);
    saveQuestionBank();renderQuestionEditor();
  });
}
function addEditorRow(parent,value,onChange){
  const row=document.createElement("div");row.className="questionEditorRow";
  const input=document.createElement("textarea");input.rows=2;input.value=value;input.className="questionEditorInput";input.spellcheck=true;
  const stamp=document.createElement("span");stamp.className="questionEditorSaved";stamp.textContent="saved";
  input.addEventListener("input",()=>{onChange(input.value.trim()||value);stamp.textContent=`saved ${new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}`});
  row.append(input,stamp);parent.append(row);
}
function addEditorAddButton(parent,fn){
  const b=document.createElement("button");b.type="button";b.className="questionEditorAdd";b.textContent="+ add question";b.onclick=fn;parent.append(b);
}


function applyParallax(x, y){
  const a=settings.appearance||DEFAULT_APPEARANCE;
  const textAmount=Math.max(0,Number(a.parallaxText)||0);
  const bgAmount=Math.max(0,Number(a.parallaxBackground)||0);
  const scale=Math.max(100,Number(a.parallaxScale)||100)/100;

  // Pointer coordinates are normalized around the center of the viewport.
  // Text moves with the pointer; the background moves in the opposite direction
  // to create depth.
  const tx=x*textAmount, ty=y*textAmount;
  const bx=-x*bgAmount, by=-y*bgAmount;

  document.documentElement.style.setProperty("--parallax-text-x",`${tx.toFixed(2)}px`);
  document.documentElement.style.setProperty("--parallax-text-y",`${ty.toFixed(2)}px`);
  document.documentElement.style.setProperty("--parallax-bg-x",`${bx.toFixed(2)}px`);
  document.documentElement.style.setProperty("--parallax-bg-y",`${by.toFixed(2)}px`);
  document.documentElement.style.setProperty("--parallax-bg-scale",scale.toFixed(3));
}

let parallaxFrame=null;
let parallaxPointerX=0,parallaxPointerY=0;
function handleParallaxPointer(e){
  const x=(e.clientX/window.innerWidth-.5)*2;
  const y=(e.clientY/window.innerHeight-.5)*2;
  parallaxPointerX=Math.max(-1,Math.min(1,x));
  parallaxPointerY=Math.max(-1,Math.min(1,y));
  if(parallaxFrame===null){
    parallaxFrame=requestAnimationFrame(()=>{
      parallaxFrame=null;
      applyParallax(parallaxPointerX,parallaxPointerY);
    });
  }
}
function resetParallax(){
  if(parallaxFrame!==null){cancelAnimationFrame(parallaxFrame);parallaxFrame=null;}
  applyParallax(0,0);
}
window.addEventListener("pointermove",handleParallaxPointer,{passive:true});
window.addEventListener("touchmove",e=>{
  const t=e.touches&&e.touches[0];
  if(t)handleParallaxPointer(t);
},{passive:true});
window.addEventListener("pointerleave",resetParallax,{passive:true});
window.addEventListener("blur",resetParallax);

// Mobile enhancement: use device tilt when available. The effect is deliberately
// small and filtered so it feels like depth rather than camera shake.
let motionX=0,motionY=0,motionReady=false;
function handleDeviceMotion(e){
  if(!e) return;
  const gamma=Number(e.gamma)||0;
  const beta=Number(e.beta)||0;
  motionX=Math.max(-1,Math.min(1,gamma/30));
  motionY=Math.max(-1,Math.min(1,(beta-45)/30));
  if(motionReady && window.matchMedia && window.matchMedia("(pointer:coarse)").matches){
    if(parallaxFrame===null){
      parallaxFrame=requestAnimationFrame(()=>{
        parallaxFrame=null;
        applyParallax(motionX,motionY);
      });
    }
  }
}
function enableDeviceMotion(){
  if(!window.DeviceOrientationEvent)return;
  try{window.addEventListener("deviceorientation",handleDeviceMotion,{passive:true});motionReady=true;}catch{}
}
if(window.matchMedia && window.matchMedia("(pointer:coarse)").matches){
  if(typeof DeviceOrientationEvent!=="undefined" && typeof DeviceOrientationEvent.requestPermission==="function"){}
  else enableDeviceMotion();
}
document.addEventListener("pointerdown",()=>{
  if(typeof DeviceOrientationEvent!=="undefined" && typeof DeviceOrientationEvent.requestPermission==="function")
    DeviceOrientationEvent.requestPermission().then(state=>{if(state==="granted")enableDeviceMotion();}).catch(()=>{});
},{once:true,passive:true});

const APPEARANCE_PRESETS={
  midnight:{backgroundColor:"#10100f",textColor:"#ebe8e0",accentColor:"#aaa69d",overlayColor:"#10100f",overlayOpacity:30,backgroundOpacity:35,blur:0,grayscale:0,saturation:100,brightness:100,contrast:100,sepia:0,parallaxText:10,parallaxBackground:18,parallaxScale:108},
  paper:{backgroundColor:"#e7e1d5",textColor:"#24231f",accentColor:"#706b61",overlayColor:"#f2ede3",overlayOpacity:16,backgroundOpacity:20,blur:0,grayscale:0,saturation:80,brightness:104,contrast:94,sepia:8},
  forest:{backgroundColor:"#0d1511",textColor:"#e4eee6",accentColor:"#91ad9b",overlayColor:"#08100b",overlayOpacity:35,backgroundOpacity:32,blur:1,grayscale:8,saturation:92,brightness:92,contrast:108,sepia:0},
  ocean:{backgroundColor:"#0d1318",textColor:"#e6edf2",accentColor:"#91aabd",overlayColor:"#071017",overlayOpacity:38,backgroundOpacity:34,blur:1,grayscale:6,saturation:92,brightness:94,contrast:106,sepia:0},
  rose:{backgroundColor:"#171012",textColor:"#f1e7e7",accentColor:"#b89a9e",overlayColor:"#170c10",overlayOpacity:36,backgroundOpacity:28,blur:1,grayscale:10,saturation:88,brightness:94,contrast:104,sepia:4}
};

function hexToRgba(hex,alpha){
  const h=String(hex||"").replace("#","");
  if(!/^[0-9a-f]{6}$/i.test(h))return `rgba(16,16,15,${alpha})`;
  const n=parseInt(h,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${Math.max(0,Math.min(1,alpha))})`;
}
function formatPercent(value){
  const n=Number(value)||0;
  return `${n<10?n.toFixed(1).replace(/\.0$/ ,""):Math.round(n)}%`;
}
function applyAppearance(){
  const a=settings.appearance||DEFAULT_APPEARANCE;
  const root=document.documentElement;
  root.style.setProperty("--bg",a.backgroundColor);
  root.style.setProperty("--text",a.textColor);
  root.style.setProperty("--muted",a.accentColor);
  root.style.setProperty("--line",hexToRgba(a.textColor,.16));
  root.style.setProperty("--accent",a.accentColor);
  root.style.setProperty("--overlay",hexToRgba(a.overlayColor,(Number(a.overlayOpacity)||0)/100));

  const bg=$("customBackground");
  if(bg){
    bg.style.backgroundImage=a.backgroundImage?`url("${a.backgroundImage}")`:"none";
    bg.style.opacity=Math.max(0,Math.min(100,Number(a.backgroundOpacity)||0))/100;
    bg.style.filter=`blur(${Number(a.blur)||0}px) grayscale(${Number(a.grayscale)||0}%) saturate(${Number(a.saturation) || 100}%) brightness(${Number(a.brightness)||100}%) contrast(${Number(a.contrast)||100}%) sepia(${Number(a.sepia)||0}%)`;
    bg.classList.toggle("hasImage",!!a.backgroundImage);
  }
  const overlay=$("customBackgroundOverlay");
  if(overlay){
    overlay.style.background=a.overlayColor;
    overlay.style.opacity=Math.max(0,Math.min(100,Number(a.overlayOpacity)||0))/100;
  }
  document.documentElement.style.setProperty("--appearance-overlay",hexToRgba(a.overlayColor,(Number(a.overlayOpacity)||0)/100));

  [
    ["backgroundColor","backgroundColor"],["textColor","textColor"],["accentColor","accentColor"],["overlayColor","overlayColor"],
    ["backgroundOpacity","backgroundOpacity"],["overlayOpacity","overlayOpacity"],["backgroundBlur","blur"],["backgroundGrayscale","grayscale"],
    ["backgroundSaturation","saturation"],["backgroundBrightness","brightness"],["backgroundContrast","contrast"],["backgroundSepia","sepia"],
    ["parallaxText","parallaxText"],["parallaxBackground","parallaxBackground"],["parallaxScale","parallaxScale"]
  ].forEach(([id,key])=>{const el=$(id);if(el)el.value=a[key]});
  const labels={
    backgroundOpacity:`${formatPercent(a.backgroundOpacity)}`,overlayOpacity:`${formatPercent(a.overlayOpacity)}`,backgroundBlur:`${a.blur}px`,
    backgroundGrayscale:`${a.grayscale}%`,backgroundSaturation:`${a.saturation}%`,backgroundBrightness:`${a.brightness}%`,
    backgroundContrast:`${a.contrast}%`,backgroundSepia:`${a.sepia}%`,
    parallaxText:`${Math.round(Number(a.parallaxText)||0)}px`,
    parallaxBackground:`${Math.round(Number(a.parallaxBackground)||0)}px`,
    parallaxScale:`${Math.round(Number(a.parallaxScale)||100)}%`
  };
  Object.entries(labels).forEach(([id,value])=>{const el=$(id+"Value");if(el)el.textContent=value});
  const name=$("backgroundFileName");
  if(name)name.textContent=a.backgroundFileName||"no custom background";
  applyParallax(parallaxPointerX,parallaxPointerY);
}
function updateAppearanceValue(key,value){
  settings.appearance[key]=value;
  saveSettings();
  applyAppearance();
}
function applyAppearancePreset(name){
  const preset=APPEARANCE_PRESETS[name];
  if(!preset)return;
  settings.appearance={...settings.appearance,...preset};
  saveSettings();
  applyAppearance();
}
function resetAppearance(){
  settings.appearance={...DEFAULT_APPEARANCE};
  saveSettings();
  applyAppearance();
}
function resizeImageForStorage(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("Could not read the image."));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error("That image could not be decoded."));
      img.onload=()=>{
        const max=1920;
        const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
        const w=Math.max(1,Math.round(img.naturalWidth*scale));
        const h=Math.max(1,Math.round(img.naturalHeight*scale));
        const canvas=document.createElement("canvas");
        canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext("2d");
        ctx.drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL("image/jpeg",.82));
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function buildBackup(){
  return {
    format:"one-question-zen-backup",
    version:"2.15.2",
    exportedAt:new Date().toISOString(),
    data:{
      questions:questions.slice(),
      focusQuestions:focusQuestions.slice(),
      settings:JSON.parse(JSON.stringify(settings)),
      history:getHistory(),
      recent:getRecent(),
      todos:getTodos()
    }
  };
}
function exportBackup(){
  try{
    const blob=new Blob([JSON.stringify(buildBackup(),null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    const stamp=new Date().toISOString().slice(0,10);
    a.href=url;a.download=`one-question-zen-backup-${stamp}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setDataStatus("backup exported");
  }catch(e){
    console.error("One Question: export failed",e);
    setDataStatus("export failed");
  }
}
function validBackup(payload){
  const d=payload&&payload.data;
  return !!(payload&&payload.format==="one-question-zen-backup"&&d&&
    Array.isArray(d.questions)&&Array.isArray(d.focusQuestions)&&
    d.settings&&typeof d.settings==="object"&&Array.isArray(d.history)&&
    Array.isArray(d.recent)&&Array.isArray(d.todos));
}
async function importBackup(file){
  if(!file)return;
  try{
    const payload=JSON.parse(await file.text());
    if(!validBackup(payload))throw new Error("This is not a valid One Question backup.");
    const d=payload.data;
    const importedQuestions=d.questions.filter(x=>Array.isArray(x)&&x.length>=2&&typeof x[0]==="string"&&typeof x[1]==="string"&&x[1].trim()).map(x=>[x[0],x[1].trim()]);
    const importedFocus=d.focusQuestions.filter(x=>typeof x==="string"&&x.trim()).map(x=>x.trim());
    if(!importedQuestions.length||!importedFocus.length)throw new Error("The backup does not contain a usable question library.");
    questions=importedQuestions;
    focusQuestions=importedFocus;
    settings={...DEFAULT_SETTINGS,...d.settings,categories:Array.isArray(d.settings.categories)&&d.settings.categories.length?d.settings.categories:["all"],appearance:{...DEFAULT_APPEARANCE,...(d.settings.appearance||{})}};
    saveQuestionBank();
    saveFocusQuestions();
    saveSettings();
    saveHistory(Array.isArray(d.history)?d.history:[]);
    saveRecent(Array.isArray(d.recent)?d.recent:[]);
    saveTodos(Array.isArray(d.todos)?d.todos:[]);
    applyAppearance();
    renderSettings();
    renderTodos();
    updateModeUI();
    historyIndex=0;viewedQuestions=[];viewedPosition=-1;
    const initial=chooseFreshIndex();
    viewedQuestions=[initial];viewedPosition=0;renderQuestion(initial);
    setDataStatus("backup imported successfully");
  }catch(e){
    console.error("One Question: import failed",e);
    setDataStatus(`import failed: ${e.message||"invalid backup"}`);
  }
}

function renderSettings(){
  const wrap=$("categoryOptions");
  wrap.innerHTML="";
  const all=document.createElement("label");
  all.className="settingCheck";
  all.innerHTML='<input type="checkbox" value="all"><span>all categories</span>';
  wrap.append(all);

  uniqueCategories().forEach(cat=>{
    const label=document.createElement("label");
    label.className="settingCheck";
    label.innerHTML=`<input type="checkbox" value="${cat}"><span>${cat}</span>`;
    wrap.append(label);
  });

  const chosen=settings.categories.includes("all")?new Set(["all"]):new Set(settings.categories);
  wrap.querySelectorAll("input").forEach(b=>b.checked=chosen.has(b.value));
  $("cycleSeconds").value=settings.cycleSeconds;
  $("cycleSecondsValue").textContent=`${Number(settings.cycleSeconds).toFixed(1)}s`;
  $("animationEnabled").checked=!!settings.animation;
  applyAppearance();
  renderQuestionEditor();
}
function openSettings(){renderSettings();$("settingsPanel").classList.add("open");}
function closeSettings(){$("settingsPanel").classList.remove("open")}
function normalizeCategories(values){
  const cats=[...new Set(values.filter(v=>v!=="all"))];
  return (!cats.length||values.includes("all"))?["all"]:cats;
}
function applyCategories(values){
  settings.categories=normalizeCategories(values);
  saveSettings();
  closeCategoryMenu();
  if(currentMode==="question"){
    isAnswering=false;
    cyclePaused=false;
    showQuestion(chooseFreshIndex());
  }
}
function renderCategoryMenu(){
  const menu=$("categoryMenu");
  menu.innerHTML="";
  const title=document.createElement("div");
  title.className="categoryMenuTitle";
  title.textContent="questions from";
  menu.append(title);

  const allLabel=document.createElement("label");
  allLabel.className="categoryOption";
  allLabel.innerHTML='<input type="checkbox" value="all"><span>all categories</span>';
  const allInput=allLabel.querySelector("input");
  allInput.checked=settings.categories.includes("all");
  allInput.onchange=()=>{
    if(allInput.checked)applyCategories(["all"]);
  };
  menu.append(allLabel);

  uniqueCategories().forEach(cat=>{
    const label=document.createElement("label");
    label.className="categoryOption";
    label.innerHTML=`<input type="checkbox" value="${cat}"><span>${cat}</span>`;
    const input=label.querySelector("input");
    input.checked=!settings.categories.includes("all")&&settings.categories.includes(cat);
    input.onchange=()=>{
      const values=[...menu.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
      applyCategories(values);
      setTimeout(()=>{if(!settings.categories.includes("all"))toggleCategoryMenu();},0);
    };
    menu.append(label);
  });
}
function toggleCategoryMenu(){
  const m=$("categoryMenu");
  const open=!m.classList.contains("open");
  m.classList.toggle("open",open);
  categoryEl.setAttribute("aria-expanded",String(open));
  m.setAttribute("aria-hidden",String(!open));
  if(open)renderCategoryMenu();
}
function closeCategoryMenu(){
  const m=$("categoryMenu");
  m.classList.remove("open");
  categoryEl.setAttribute("aria-expanded","false");
  m.setAttribute("aria-hidden","true");
}
function updateFocusUI(){
  const focusActions=$("focusModeActions");
  focusEl.classList.toggle("focusMode",currentMode==="focus");
  focusActions.classList.toggle("open",currentMode==="focus");
  focusActions.setAttribute("aria-hidden",String(currentMode!=="focus"));
  $("answerMetaHint").textContent=currentMode==="focus"?"enter to add this as a todo":"enter to save · shift + enter for a new line";
  if(currentMode==="focus"){
    categoryEl.textContent="focus mode";
  }
}
function enterFocusMode(){
  clearTimeout(cycleTimer);closeCategoryMenu();currentMode="focus";cyclePaused=false;isAnswering=false;
  document.body.classList.add("focusModeVisual");
  updateModeUI();updateFocusUI();showFocusQuestion(chooseFreshFocusIndex());
  setCycleStatus("cycling",true);answerEl.focus();
}
function enterQuestionMode(){
  clearTimeout(cycleTimer);
  currentMode="question";
  cyclePaused=false;
  isAnswering=false;
  document.body.classList.remove("focusModeVisual");
  updateModeUI();
  updateFocusUI();
  showQuestion(chooseFreshIndex());
}
function selectMode(mode){
  closeModeMenu();
  if(mode==="question")enterQuestionMode();
  else if(mode==="focus")enterFocusMode();
}

$("previousQuestion").onclick=previousQuestion;
$("cycleToggle").onclick=toggleCycle;
$("history").onclick=showHistory;
$("closeHistory").onclick=closeHistory;
$("historyPrevious").onclick=historyPrevious;
$("historyNext").onclick=historyNext;
$("newQuestion").onclick=nextQuestion;
$("settings").onclick=openSettings;
$("category").onclick=toggleCategoryMenu;

$("modeToggle").onclick=toggleModeMenu;

$("closeSettings").onclick=closeSettings;
$("settingsPanel").addEventListener("click",e=>{if(e.target===$("settingsPanel"))closeSettings()});

$("categoryOptions").addEventListener("change",e=>{
  const target=e.target;
  if(target.value==="all"&&target.checked){
    $("categoryOptions").querySelectorAll("input").forEach(x=>{if(x!==target)x.checked=false});
  }else if(target.value!=="all"&&target.checked){
    const all=$("categoryOptions").querySelector('input[value="all"]');
    if(all)all.checked=false;
  }
  const values=[...$("categoryOptions").querySelectorAll("input:checked")].map(x=>x.value);
  applyCategories(values);
  renderSettings();
});

$("cycleSeconds").addEventListener("input",e=>{
  settings.cycleSeconds=Number(e.target.value);
  $("cycleSecondsValue").textContent=`${settings.cycleSeconds.toFixed(1)}s`;
  saveSettings();
  if(currentMode==="question"&&!cyclePaused&&!isAnswering)startCycle();
});
$("animationEnabled").addEventListener("change",e=>{
  settings.animation=e.target.checked;
  saveSettings();
});

[["backgroundColor","backgroundColor"],["textColor","textColor"],["accentColor","accentColor"],["overlayColor","overlayColor"]].forEach(([id,key])=>{
  $(id).addEventListener("input",e=>updateAppearanceValue(key,e.target.value));
});
[["backgroundOpacity","backgroundOpacity"],["overlayOpacity","overlayOpacity"],["backgroundBlur","blur"],["backgroundGrayscale","grayscale"],["backgroundSaturation","saturation"],["backgroundBrightness","brightness"],["backgroundContrast","contrast"],["backgroundSepia","sepia"],["parallaxText","parallaxText"],["parallaxBackground","parallaxBackground"],["parallaxScale","parallaxScale"]].forEach(([id,key])=>{
  $(id).addEventListener("input",e=>updateAppearanceValue(key,Number(e.target.value)));
});

$("backgroundImage").addEventListener("change",async e=>{
  const file=e.target.files&&e.target.files[0];
  if(!file)return;
  if(!file.type.startsWith("image/"))return;
  try{
    const data=await resizeImageForStorage(file);
    settings.appearance.backgroundImage=data;
    settings.appearance.backgroundFileName=file.name;
    saveSettings();
    applyAppearance();
  }catch(err){
    console.warn("One Question: background image could not be saved",err);
    alert("That image could not be saved. Try a smaller image file.");
  }
  e.target.value="";
});
$("removeBackground").onclick=()=>{
  settings.appearance.backgroundImage="";
  settings.appearance.backgroundFileName="";
  saveSettings();
  applyAppearance();
};
document.querySelectorAll(".appearancePreset").forEach(btn=>btn.addEventListener("click",()=>applyAppearancePreset(btn.dataset.preset)));
$("resetAppearance").onclick=resetAppearance;

$("exportData").onclick=exportBackup;
$("importData").addEventListener("change",async e=>{
  const file=e.target.files&&e.target.files[0];
  if(file){
    const ok=confirm("Importing a backup will replace your current One Question data. Continue?");
    if(ok)await importBackup(file);
  }
  e.target.value="";
});

$("date").onclick=toggleCalendar;
$("calendarPrev").onclick=()=>{calendarMonthDate=new Date(calendarMonthDate.getFullYear(),calendarMonthDate.getMonth()-1,1);renderCalendar()};
$("calendarNext").onclick=()=>{calendarMonthDate=new Date(calendarMonthDate.getFullYear(),calendarMonthDate.getMonth()+1,1);renderCalendar()};
$("todoDock").onclick=openToday;
$("closeTodoFullscreen").onclick=closeToday;
$("todoFullscreenAdd").onclick=addFullscreenTodo;
$("todoFullscreenInput").addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();addFullscreenTodo();}
  else if(e.key==="Escape"){e.preventDefault();closeToday();}
});

answerEl.addEventListener("focus",beginAnswering);
answerEl.addEventListener("input",()=>{if(currentMode==="focus")isAnswering=true;});
answerEl.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();saveAnswer();}
});

$("focusNotNow").onclick=()=>{
  if(currentMode!=="focus")return;
  answerEl.textContent="";
  isAnswering=false;
  cyclePaused=false;
  clearTimeout(cycleTimer);
  showFocusQuestion(chooseFreshFocusIndex());
  answerEl.focus();
};

document.addEventListener("keydown",e=>{
  if(!$("historyPanel").classList.contains("open"))return;
  if(e.key==="ArrowLeft"){e.preventDefault();historyPrevious();}
  else if(e.key==="ArrowRight"){e.preventDefault();historyNext();}
});

document.addEventListener("pointerdown",e=>{
  const button=e.target.closest("button");
  if(button)setTimeout(()=>button.blur(),0);
  if(!e.target.closest(".eyebrowRow"))closeCategoryMenu();
});

document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  if($("todoFullscreen").classList.contains("open")){closeToday();return;}
  if($("calendarPanel").classList.contains("open")){closeCalendar();return;}
  if($("settingsPanel").classList.contains("open")){closeSettings();return;}
  if($("historyPanel").classList.contains("open")){closeHistory();return;}
  closeCategoryMenu();
});

applyAppearance();
dateEl.textContent=new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(new Date());
renderTodos();
renderCalendar();
updateModeUI();
updateCycleToggle();

const initial=chooseFreshIndex();
viewedQuestions=[initial];
viewedPosition=0;
renderQuestion(initial);
focusEl.classList.add("questionIn");
setTimeout(()=>focusEl.classList.remove("questionIn"),1100);
startCycle();

hydrateBrowserStorage().then(()=>{
  questions=loadQuestionBank();
  focusQuestions=loadFocusQuestions();
  settings=loadSettings();
  if(Object.keys(wallpaperEngineProperties).length) applyWallpaperEngineProperties(wallpaperEngineProperties);
  renderSettings();
  renderTodos();
  applyAppearance();
  const refreshed=chooseFreshIndex();
  viewedQuestions=[refreshed];
  viewedPosition=0;
  renderQuestion(refreshed);
});