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
  "oneQuestionHistory","oneQuestionRecent","oneQuestionTodos","oneQuestionNote"
];

function cacheSet(key,value){
  try{localStorage.setItem(key,JSON.stringify(value))}catch(e){console.warn("One Question: local cache write failed",e)}
  if(extensionStorage){
    extensionStorage.set({[key]:value}).catch(e=>console.warn("One Question: browser storage write failed",e));
  }
  if(SYNC_KEYS.includes(key)){
    touchSyncTime(key);
    scheduleSyncPush();
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

// ---- automatic sync: every save pushes to the One Question server ----
const SYNC_KEYS=[...new Set([...STORAGE_KEYS,"oneQuestionSchedule","oneQuestionStickies","oneQuestionTimer","oneQuestionHydration"])];
let syncPushTimer=null,syncBusy=false;
function syncBase(){
  return ((settings&&settings.syncServer)||SYNC_BASE).replace(/\/+$/,"");
}
function readSyncTimes(){
  try{return JSON.parse(localStorage.getItem("oneQuestionSyncTimes")||"{}")}catch{return{}}
}
function touchSyncTime(key){
  const times=readSyncTimes();
  times[key]=Date.now();
  try{localStorage.setItem("oneQuestionSyncTimes",JSON.stringify(times))}catch{}
}
function scheduleSyncPush(){
  clearTimeout(syncPushTimer);
  syncPushTimer=setTimeout(pushSyncToServer,800);
}
async function pushSyncToServer(){
  if(syncBusy)return;
  syncBusy=true;
  try{
    const times=readSyncTimes();
    const changes={};
    for(const key of SYNC_KEYS){
      const raw=localStorage.getItem(key);
      if(raw===null)continue;
      let value;
      try{value=JSON.parse(raw)}catch{continue}
      changes[key]={value,updatedAt:times[key]||Date.now()};
    }
    if(!Object.keys(changes).length)return;
    await fetch(`${syncBase()}/api/state`,{
      method:"PUT",headers:{"Content-Type":"application/json"},cache:"no-store",
      body:JSON.stringify({changes})
    });
    setDataStatus("synced to server");
  }catch(e){
    console.warn("One Question: sync push failed",e);
  }finally{syncBusy=false}
}
async function pullSyncFromServer(){
  try{
    const res=await fetch(`${syncBase()}/api/state`,{cache:"no-store"});
    if(!res.ok)return;
    const data=await res.json();
    const entries=data&&data.keys||{};
    const times=readSyncTimes();
    let adopted=false;
    for(const key of SYNC_KEYS){
      const entry=entries[key];
      if(entry&&entry.value!=null&&(entry.updatedAt||0)>(times[key]||0)){
        try{
          localStorage.setItem(key,JSON.stringify(entry.value));
          times[key]=entry.updatedAt;
          adopted=true;
        }catch{}
      }
    }
    if(adopted){
      try{localStorage.setItem("oneQuestionSyncTimes",JSON.stringify(times))}catch{}
      // restart once so everything renders from the freshly synced data
      if(!sessionStorage.getItem("oneQuestionSyncReload")){
        sessionStorage.setItem("oneQuestionSyncReload","1");
        location.reload();
      }
    }
  }catch(e){
    console.warn("One Question: sync pull unavailable",e);
  }
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


// Hydration reminder is shared through the local One Question server so the
// browser wallpaper/web page can keep the same reminder state across tabs.
const SYNC_BASE="http://127.0.0.1:8765";
const HYDRATION_KEY="oneQuestionHydration";
const DEFAULT_HYDRATION_MINUTES=60;
const DEFAULT_HYDRATION_SECONDS=DEFAULT_HYDRATION_MINUTES*60;
const DEFAULT_HYDRATION_SIZE=24;
const DEFAULT_HYDRATION_HOVER_SCALE=1.5;
const DEFAULT_SCREEN_SCALE=1;
let hydrationState={lastDrinkAt:0,drinkCount:0,lastDate:"",drinkHistory:[]};
let hydrationTimer=null;
let hydrationServerBusy=false;

function hydrationInterval(){
  const legacySeconds=Number(settings.hydrationMinutes)*60;
  const seconds=Math.min(86400,Math.max(1,Number(settings.hydrationSeconds)||legacySeconds||DEFAULT_HYDRATION_SECONDS));
  return seconds*1000;
}
function hydrationDurationParts(){
  const total=Math.min(86400,Math.max(1,Math.round(hydrationInterval()/1000)));
  return {hours:Math.floor(total/3600),minutes:Math.floor((total%3600)/60),seconds:total%60};
}
function updateHydrationDuration(){
  const hours=Math.min(24,Math.max(0,Number($("hydrationHours").value)||0));
  const minutes=Math.min(59,Math.max(0,Number($("hydrationMinutesPart").value)||0));
  const seconds=Math.min(59,Math.max(0,Number($("hydrationSeconds").value)||0));
  settings.hydrationSeconds=Math.min(86400,Math.max(1,hours*3600+minutes*60+seconds));
  const parts=hydrationDurationParts();
  $("hydrationHours").value=parts.hours;
  $("hydrationMinutesPart").value=parts.minutes;
  $("hydrationSeconds").value=parts.seconds;
  saveSettings();
  scheduleHydrationReminder();
}
function hydrationHistory(){
  return Array.isArray(hydrationState.drinkHistory)
    ? hydrationState.drinkHistory.filter(value=>Number.isFinite(Number(value))).map(Number).sort((a,b)=>a-b)
    : [];
}
function hydrationAverageInterval(){
  const history=hydrationHistory();
  if(history.length<2)return 0;
  const total=history.slice(1).reduce((sum,value,index)=>sum+value-history[index],0);
  return total/(history.length-1);
}
function formatHydrationDuration(milliseconds){
  if(!milliseconds)return "not enough data";
  const minutes=Math.round(milliseconds/60000);
  if(minutes<60)return `${minutes}m`;
  const hours=Math.floor(minutes/60);
  const remainder=minutes%60;
  return remainder?`${hours}h ${remainder}m`:`${hours}h`;
}
function updateHydrationHistoryUI(){
  const average=$("hydrationAverage");
  if(average)average.textContent=`average time: ${formatHydrationDuration(hydrationAverageInterval())}`;
  const list=$("hydrationHistory");
  if(!list)return;
  const history=hydrationHistory().slice(-10).reverse();
  list.innerHTML=history.length?history.map(timestamp=>`<div class="hydrationHistoryItem"><span>${new Date(timestamp).toLocaleDateString()} ${new Date(timestamp).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span><span>${formatHydrationDuration(Date.now()-timestamp)} ago</span></div>`).join(""):"<div class=\"hydrationHistoryEmpty\">no drinks recorded yet</div>";
}
function shakeHydrationReminder(){
  const el=$("hydrationReminder");
  if(!el)return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
  setTimeout(()=>el.classList.remove("shake"),500);
}
function applyHydrationAppearance(){
  const size=Math.min(48,Math.max(12,Number(settings.hydrationSize)||DEFAULT_HYDRATION_SIZE));
  const hoverScale=Math.min(2.5,Math.max(1.1,Number(settings.hydrationHoverScale)||DEFAULT_HYDRATION_HOVER_SCALE));
  document.documentElement.style.setProperty("--hydration-size",`${size}px`);
  document.documentElement.style.setProperty("--hydration-hover-scale",hoverScale.toFixed(2));
  document.body.classList.toggle("hydration-wave-off",settings.hydrationWave===false);
  document.body.classList.toggle("hydration-hover-off",settings.hydrationHoverEnabled!==true);
}
function applyScreenScale(){
  const scale=Math.min(1.2,Math.max(.8,Number(settings.screenScale)||DEFAULT_SCREEN_SCALE));
  document.documentElement.style.setProperty("--screen-scale",scale.toFixed(2));
}

function readHydrationLocal(){
  try{
    const value=JSON.parse(localStorage.getItem(HYDRATION_KEY)||"null");
    return value&&typeof value==="object"?{...value,drinkHistory:Array.isArray(value.drinkHistory)?value.drinkHistory:[]}:{lastDrinkAt:0,drinkCount:0,lastDate:"",drinkHistory:[]};
  }catch{return {lastDrinkAt:0,drinkCount:0,lastDate:"",drinkHistory:[]};}
}
function writeHydrationLocal(value){
  hydrationState=value&&typeof value==="object"?value:{lastDrinkAt:0,drinkCount:0,lastDate:""};
  try{localStorage.setItem(HYDRATION_KEY,JSON.stringify(hydrationState))}catch{}
}
async function fetchHydrationState(){
  try{
    const response=await fetch(`${SYNC_BASE}/api/state`,{cache:"no-store"});
    if(!response.ok)throw new Error(`server returned ${response.status}`);
    const data=await response.json();
    const entry=data?.keys?.[HYDRATION_KEY];
    if(entry&&entry.value&&typeof entry.value==="object") writeHydrationLocal(entry.value);
  }catch(e){
    // The wallpaper still works without the local server.
    console.warn("One Question: hydration sync unavailable",e);
  }
}
async function saveHydrationState(){
  if(hydrationServerBusy)return;
  hydrationServerBusy=true;
  try{
    await fetch(`${SYNC_BASE}/api/state`,{
      method:"PUT",headers:{"Content-Type":"application/json"},cache:"no-store",
      body:JSON.stringify({changes:{[HYDRATION_KEY]:{value:hydrationState,updatedAt:Date.now()}}})
    });
  }catch(e){
    console.warn("One Question: hydration could not sync",e);
  }finally{hydrationServerBusy=false}
}
function updateHydrationFill(){
  const el=$("hydrationReminder");
  if(!el)return;
  const elapsed=Date.now()-Number(hydrationState.lastDrinkAt||0);
  const fill=Math.min(1,elapsed/hydrationInterval());
  el.style.setProperty("--hydration-fill",fill.toFixed(3));

  const p=$("hydrationPercent");
  if(p)p.textContent=`${Math.round(fill*100)}%`;

  const c=$("hydrationCount");
  if(c){
    const average=hydrationAverageInterval();
    c.textContent=average?`average: ${formatHydrationDuration(average)}`:"average: not enough data";
  }
  updateHydrationHistoryUI();
}
function hideHydrationReminder(){
  const el=$("hydrationReminder");
  if(!el)return;
  el.classList.remove("show","done");
  el.classList.add("hydrating");
  el.setAttribute("aria-hidden","false");
  setTimeout(()=>el.classList.add("done"),650);
  setTimeout(()=>{
    el.classList.remove("done","hydrating");
    updateHydrationFill();
  },850);
}
function showHydrationReminder(){
  const el=$("hydrationReminder");
  if(!el)return;
  el.classList.remove("done","hydrating");
  el.classList.add("show");
  el.setAttribute("aria-hidden","false");
}
function scheduleHydrationReminder(){
  clearTimeout(hydrationTimer);
  const el=$("hydrationReminder");
  if(el){el.classList.add("show");el.classList.remove("done");el.setAttribute("aria-hidden","false");}
  updateHydrationFill();
  const elapsed=Date.now()-Number(hydrationState.lastDrinkAt||0);
  const delay=hydrationState.lastDrinkAt>0
    ? Math.max(0,hydrationInterval()-elapsed)
    : hydrationInterval();
  hydrationTimer=setTimeout(()=>{showHydrationReminder();updateHydrationFill();},delay);
}
function markHydrated(){
  const elapsed=Date.now()-Number(hydrationState.lastDrinkAt||0);
  if(!hydrationState.lastDrinkAt||elapsed<hydrationInterval()){
    shakeHydrationReminder();
    return;
  }
  const today=todayKey();
  if(hydrationState.lastDate!==today){
    hydrationState.drinkCount=0;
    hydrationState.lastDate=today;
  }
  hydrationState.drinkCount=(hydrationState.drinkCount||0)+1;
  hydrationState.lastDrinkAt=Date.now();
  hydrationState.drinkHistory=[...hydrationHistory(),hydrationState.lastDrinkAt].slice(-100);

  writeHydrationLocal(hydrationState);
  hideHydrationReminder();
  saveHydrationState();
  scheduleHydrationReminder();
}
function initHydrationReminder(){
  hydrationState=readHydrationLocal();
  applyHydrationAppearance();
  applyScreenScale();
  $("hydrationDone")?.addEventListener("click",markHydrated);
  fetchHydrationState().finally(()=>scheduleHydrationReminder());
  setInterval(updateHydrationFill,1000);
}

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
  parallaxScale:108,
  textSize:100,
  fontWeight:400
};
const DEFAULT_SETTINGS={categories:["all"],cycleSeconds:6.5,hydrationMinutes:DEFAULT_HYDRATION_MINUTES,hydrationSize:DEFAULT_HYDRATION_SIZE,hydrationWave:true,hydrationHoverEnabled:false,hydrationHoverScale:DEFAULT_HYDRATION_HOVER_SCALE,screenScale:DEFAULT_SCREEN_SCALE,animation:true,timerAnimation:true,lowercase:false,schedulerListVisible:true,appearance:{...DEFAULT_APPEARANCE}};
let settings=loadSettings();

function loadSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem("oneQuestionSettings")||"{}");
    const categories=Array.isArray(saved.categories)&&saved.categories.length?saved.categories:["all"];
    return {...DEFAULT_SETTINGS,...saved,categories,appearance:{...DEFAULT_APPEARANCE,...(saved.appearance||{})}};
  }catch{return {...DEFAULT_SETTINGS,appearance:{...DEFAULT_APPEARANCE}}}
}
function saveSettings(){cacheSet("oneQuestionSettings",settings);document.body.classList.toggle("lowercase",!!settings.lowercase)}
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
  const btn=$("modeToggle");
  if(btn){
    btn.classList.toggle("active",currentMode==="focus");
    btn.classList.toggle("schedulerActive",currentMode==="scheduler");
    btn.setAttribute("aria-pressed",String(currentMode!=="question"));
    btn.setAttribute("title",currentMode==="focus"?"question mode":currentMode==="scheduler"?"question mode":"focus mode");
  }
  document.body.classList.toggle("todayMode",currentMode==="today");
  document.body.classList.toggle("focusModeVisual",currentMode==="focus");
  document.body.classList.toggle("schedulerVisual",currentMode==="scheduler");
  document.body.classList.toggle("stickyVisual",currentMode==="sticky");
  const sched=$("scheduler");
  if(sched)sched.setAttribute("aria-hidden",String(currentMode!=="scheduler"));
  const stickyEl=$("sticky");
  if(stickyEl)stickyEl.setAttribute("aria-hidden",String(currentMode!=="sticky"));
  if(currentMode==="scheduler")renderScheduler();
  if(currentMode==="sticky")renderStickies();
  updateFocusModePreview();
  updateTimerUI();
}
function closeModeMenu(){}
function toggleModeMenu(e){
  const icon=e&&e.target&&e.target.closest?e.target.closest(".modeIcon"):null;
  if(icon){
    if(icon.classList.contains("modeQuestion")){enterQuestionMode();return;}
    if(icon.classList.contains("modeFocus")){enterFocusMode();return;}
    if(icon.classList.contains("modeScheduler")){enterSchedulerMode();return;}
    if(icon.classList.contains("modeSticky")){enterStickyMode();return;}
  }
  if(currentMode==="question")enterFocusMode();
  else if(currentMode==="focus")enterSchedulerMode();
  else if(currentMode==="scheduler")enterStickyMode();
  else enterQuestionMode();
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


let wheelM=null,wheelAnims=[],wheelRAF=null;
function wheelMetrics(el){
  if(wheelM)return wheelM;
  const cs=getComputedStyle(el);
  const fs=parseFloat(cs.fontSize);
  const c=document.createElement("canvas").getContext("2d");
  c.font=`${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
  let inkAsc=0,inkDesc=0;
  for(const d of "0123456789"){
    const m=c.measureText(d);
    inkAsc=Math.max(inkAsc,m.actualBoundingBoxAscent/fs);
    inkDesc=Math.max(inkDesc,m.actualBoundingBoxDescent/fs);
  }
  const fAsc=c.measureText("0").fontBoundingBoxAscent/fs,fDesc=c.measureText("0").fontBoundingBoxDescent/fs;
  const baseline=(1+(fAsc-fDesc))/2;
  wheelM={h:inkAsc+inkDesc,top:baseline-inkAsc};
  return wheelM;
}
function wheelLoop(ts){
  if(!wheelLoop.last)wheelLoop.last=ts;
  const rawDt=(ts-wheelLoop.last)/1000;
  const dt=Math.min(rawDt,.1);
  wheelLoop.last=ts;
  for(const w of wheelAnims){
    if(rawDt>.5&&w.rolling){w.rows[1].textContent=w.rows[0].textContent;w.idx=1;w.rolling=false;}
    if(w.rolling&&w.idx>0){
      w.idx=Math.max(0,w.idx-dt*2.2);
      if(w.idx===0){w.rows[1].textContent=w.rows[0].textContent;w.idx=1;w.rolling=false;}
    }
    if(w.pending!=null&&w.idx===1&&!w.rolling){
      if(w.rows[1].textContent!==w.pending){w.rows[0].textContent=w.pending;w.rolling=true;}
      w.pending=null;
    }
    w.strip.style.transform=`translateY(${-(w.idx)-wheelM.top}em)`;
    const p=1-w.idx;
    w.wrap.style.transform=`scale(${(.6+.4*Math.abs(1-2*p)).toFixed(3)})`;
  }
  wheelRAF=requestAnimationFrame(wheelLoop);
}
function buildDigitWheel(el,ch){
  const M=wheelMetrics(el);
  const wrap=document.createElement("span");
  wrap.style.cssText=`display:inline-block;position:relative;height:${M.h}em;overflow:hidden;vertical-align:baseline`;
  const strip=document.createElement("span");
  strip.style.cssText="display:block;will-change:transform";
  const rows=[ch,ch,ch].map(d=>{const s=document.createElement("span");s.style.cssText="display:block;height:1em;line-height:1em";s.textContent=d;strip.appendChild(s);return s;});
  wrap.appendChild(strip);
  const w={strip,wrap,rows,idx:1,rolling:false,pending:null};
  wrap._w=w;wheelAnims.push(w);
  strip.style.transform=`translateY(${-1-wheelM.top}em)`;
  if(!wheelRAF)wheelRAF=requestAnimationFrame(wheelLoop);
  return wrap;
}
function rollDigitWheel(wrap,ch){
  const w=wrap._w;
  if(w.rows[1].textContent===ch)return;
  if(w.idx===1&&!w.rolling){w.rows[0].textContent=ch;w.rolling=true;}
  else w.pending=ch;
}
// render txt in an element as rolling digit wheels (same animation as the focus timer)
let spinTimerWheels=false;
// force a full-wheel spin to ch: the digit travels two rows so even an
// unchanged digit visibly rolls (used when switching focus/break modes)
function spinWheelTo(wrap,ch){
  const w=wrap._w;
  if(!w)return;
  if(w.rolling){w.pending=ch;return;}
  w.rows[0].textContent=ch;
  w.idx=2;
  w.rolling=true;
}
function setWheelText(el,txt){
  if(!el)return;
  if(settings.timerAnimation===false){
    if(el.dataset.wheels){delete el.dataset.wheels;el.textContent="";}
    el.textContent=txt;
  }else if(el.dataset.wheels!=="1"||el.children.length!==txt.length){
    el.textContent="";el.dataset.wheels="1";
    [...txt].forEach(ch=>{if(/\d/.test(ch)){el.appendChild(buildDigitWheel(el,ch));}else{const sp=document.createElement("span");sp.textContent=ch;el.appendChild(sp);}});
  }else{
    [...el.children].forEach((sp,i)=>{if(/\d/.test(txt[i]))rollDigitWheel(sp,txt[i]);});
  }
}
let timerMode="focus",timerSeconds=25*60,timerRunning=false,timerInterval=null,timerEndsAt=0;
const TIMER_LENGTHS={focus:25*60,short:5*60,long:15*60};
const TIMER_KEY="oneQuestionTimer";
function saveTimerState(){
  try{localStorage.setItem(TIMER_KEY,JSON.stringify({timerMode,timerRunning,timerEndsAt,timerSeconds}))}catch{}
  touchSyncTime(TIMER_KEY);
  scheduleSyncPush();
}
function restoreTimerState(){
  try{
    const s=JSON.parse(localStorage.getItem(TIMER_KEY)||"null");
    if(!s||typeof s!=="object")return;
    if(s.timerMode&&TIMER_LENGTHS[s.timerMode])timerMode=s.timerMode;
    if(s.timerRunning&&Number(s.timerEndsAt)>Date.now()){
      timerEndsAt=Number(s.timerEndsAt);
      timerSeconds=Math.max(0,Math.round((timerEndsAt-Date.now())/1000));
      timerRunning=true;
    }else if(Number.isFinite(Number(s.timerSeconds))){
      timerSeconds=Math.max(0,Math.min(TIMER_LENGTHS[timerMode]*2,Math.round(Number(s.timerSeconds))));
      timerRunning=false;timerEndsAt=0;
    }
  }catch{}
}
function updateTimerUI(){
  const active=currentMode==="focus";
  ["focusTimerControls","focusTimer","focusTimerButtons","focusQuote","focusTodoPreview"].forEach(id=>{const el=$(id);if(el)el.setAttribute("aria-hidden",String(!active));});
  const badgeTime=$("focusRunningTime");
  if(badgeTime){
    const badge=badgeTime.parentElement;
    const show=timerRunning&&currentMode!=="focus";
    badge.classList.toggle("visible",show);
    if(show){
      const m=Math.floor(timerSeconds/60),s=timerSeconds%60;
      badgeTime.textContent=`focus ${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    }
  }
  if(!active)return;
  const m=Math.floor(timerSeconds/60),s=timerSeconds%60;
  const el=$("focusTimer");
  if(el){
    const txt=`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    if(spinTimerWheels&&el.dataset.wheels==="1"){
      // mode switch: every digit spins a full wheel, even the unchanged ones
      [...el.children].forEach((sp,i)=>{
        if(/\d/.test(txt[i]))spinWheelTo(sp,txt[i]);
        else if(sp.textContent!==txt[i])sp.textContent=txt[i];
      });
    }else setWheelText(el,txt);
    spinTimerWheels=false;
    el.classList.toggle("running",timerRunning);
  }
  document.querySelectorAll(".timerMode").forEach(b=>b.classList.toggle("active",b.dataset.timer===timerMode));
  const start=$("focusTimerStart");if(start)start.textContent=timerRunning?"pause":"start";
}
function setTimerMode(mode){timerMode=mode;timerRunning=false;clearInterval(timerInterval);timerEndsAt=0;timerSeconds=TIMER_LENGTHS[mode]||TIMER_LENGTHS.focus;saveTimerState();spinTimerWheels=true;updateTimerUI();}
function tickTimer(){
  if(!timerRunning)return;
  timerSeconds=Math.max(0,Math.round((timerEndsAt-Date.now())/1000));
  if(timerSeconds<=0){timerRunning=false;clearInterval(timerInterval);timerEndsAt=0;saveTimerState();updateTimerUI();return}
  updateTimerUI();
}
function toggleTimer(){
  if(timerRunning){timerSeconds=Math.max(0,Math.round((timerEndsAt-Date.now())/1000));timerRunning=false;clearInterval(timerInterval);timerEndsAt=0}
  else{timerRunning=true;timerEndsAt=Date.now()+timerSeconds*1000;clearInterval(timerInterval);timerInterval=setInterval(tickTimer,1000)}
  saveTimerState();updateTimerUI();
}
function resetTimer(){timerRunning=false;clearInterval(timerInterval);timerEndsAt=0;timerSeconds=TIMER_LENGTHS[timerMode]||TIMER_LENGTHS.focus;saveTimerState();updateTimerUI();}
function updateFocusModePreview(){
  const quote=$("focusQuote"),todo=$("focusTodoPreview");
  if(currentMode!=="focus")return;
  if(quote)quote.textContent=focusQuestions[focusIndex]||"";
  const pending=getTodos().find(t=>!t.completed&&t.date===todayKey());
  if(todo){todo.textContent=pending?pending.text:"";todo.classList.toggle("hasTodo",!!pending);}
}
function loadNote(){
  try{
    const saved=localStorage.getItem("oneQuestionNote");
    const textarea=$("noteText");
    if(textarea){
      textarea.value=saved!==null?JSON.parse(saved):"";
    }
  }catch(e){
    console.warn("One Question: failed to load note",e);
  }
}
function saveNote(value){
  cacheSet("oneQuestionNote",value);
  const status=$("noteStatus");
  if(status){
    status.textContent="saving…";
    clearTimeout(saveNote._t);
    saveNote._t=setTimeout(()=>{status.textContent="saved";},600);
  }
}
function toggleNote(){
  const p=$("notePanel"),b=$("noteDock");
  if(!p)return;
  const open=!p.classList.contains("open");
  p.classList.toggle("open",open);
  p.setAttribute("aria-hidden",String(!open));
  b?.setAttribute("aria-expanded",String(open));
  if(open){
    closeToday();
    $("noteText")?.focus();
  }
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
      const groupHeading=document.createElement("div");groupHeading.className="todoDateGroupHeading";groupHeading.textContent=g.key===today?"":formatTodoDate(g.key,true);list.append(groupHeading);
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
  const p=$("notePanel"),b=$("noteDock");
  if(p&&p.classList.contains("open")){
    p.classList.remove("open");
    p.setAttribute("aria-hidden","true");
    b?.setAttribute("aria-expanded","false");
  }
  todoViewDate=todayKey();
  todoViewScope="upcoming";
  renderTodos(todoViewDate);
  const screen=$("todoFullscreen");
  screen.classList.add("open");
  screen.setAttribute("aria-hidden","false");
  $("todoDock")?.setAttribute("aria-expanded","true");
  setTimeout(()=>{$("todoFullscreenInput").focus()},120);
}
function closeToday(){
  todoViewScope="date";
  const screen=$("todoFullscreen");
  screen.classList.remove("open");
  screen.setAttribute("aria-hidden","true");
  $("todoDock")?.setAttribute("aria-expanded","false");
  $("todoFullscreenInput").value="";
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
  root.style.setProperty("--user-font-weight",Math.max(300,Math.min(700,Number(a.fontWeight)||400)));
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
    ["parallaxText","parallaxText"],["parallaxBackground","parallaxBackground"],["parallaxScale","parallaxScale"],["textSize","textSize"],["fontWeight","fontWeight"]
  ].forEach(([id,key])=>{const el=$(id);if(el)el.value=a[key]});
  const lightMode=$("lightModeEnabled");
  if(lightMode)lightMode.checked=!!a.lightMode;
  const themeToggle=$("themeToggle");
  if(themeToggle){
    // show the mode you would switch to: sun in dark mode, moon in light
    themeToggle.textContent=a.lightMode?"☾":"☀";
    themeToggle.setAttribute("aria-label",a.lightMode?"Switch to dark mode":"Switch to light mode");
  }
  document.body.style.zoom=(Math.max(85,Math.min(130,Number(a.textSize)||100))/100);
  const labels={
    backgroundOpacity:`${formatPercent(a.backgroundOpacity)}`,overlayOpacity:`${formatPercent(a.overlayOpacity)}`,backgroundBlur:`${a.blur}px`,
    backgroundGrayscale:`${a.grayscale}%`,backgroundSaturation:`${a.saturation}%`,backgroundBrightness:`${a.brightness}%`,
    backgroundContrast:`${a.contrast}%`,backgroundSepia:`${a.sepia}%`,
    parallaxText:`${Math.round(Number(a.parallaxText)||0)}px`,
    parallaxBackground:`${Math.round(Number(a.parallaxBackground)||0)}px`,
    parallaxScale:`${Math.round(Number(a.parallaxScale)||100)}%`,
    textSize:`${Math.round(Number(a.textSize)||100)}%`,
    fontWeight:`${Math.round(Number(a.fontWeight)||400)}`
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
const LIGHT_MODE_PRESET={...APPEARANCE_PRESETS.paper,backgroundOpacity:12,overlayOpacity:8};
// snapshot of the user's look, so light mode can be undone cleanly
function setLightMode(on){
  const a=settings.appearance;
  if(on&&!a.lightMode){
    const snapshot={...a};
    delete snapshot.lightMode;delete snapshot.lightModeRestore;
    Object.assign(a,LIGHT_MODE_PRESET,{lightMode:true,lightModeRestore:snapshot});
  }else if(!on&&a.lightMode){
    const restore=a.lightModeRestore||{...DEFAULT_APPEARANCE};
    delete restore.lightMode;delete restore.lightModeRestore;
    Object.assign(a,restore,{lightMode:false,lightModeRestore:null});
  }
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
      todos:getTodos(),
      schedule:schedulerBlocks.slice(),
      stickies:stickies.map(s=>({...s}))
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
    if(Array.isArray(d.schedule)){
      schedulerBlocks.length=0;
      d.schedule.forEach(b=>{if(Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.label)schedulerBlocks.push({start:b.start,end:b.end,label:String(b.label),color:String(b.color||SCHEDULER_PALETTE[0])})});
      saveSchedule();
      renderScheduler();
    }
    if(Array.isArray(d.stickies)){
      stickies.length=0;
      d.stickies.forEach(s=>{if(s&&typeof s.text==="string"&&s.text.trim())stickies.push({id:String(s.id||crypto.randomUUID()),text:s.text.trim(),created:Number(s.created)||Date.now(),done:!!s.done})});
      saveStickies();
      renderStickyPin();
    }
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
  const hydrationParts=hydrationDurationParts();
  $("hydrationHours").value=hydrationParts.hours;
  $("hydrationMinutesPart").value=hydrationParts.minutes;
  $("hydrationSeconds").value=hydrationParts.seconds;
  $("hydrationSize").value=Math.min(48,Math.max(12,Number(settings.hydrationSize)||DEFAULT_HYDRATION_SIZE));
  $("hydrationSizeValue").textContent=`${$("hydrationSize").value}px`;
  $("hydrationWave").checked=settings.hydrationWave!==false;
  $("hydrationHoverEnabled").checked=settings.hydrationHoverEnabled===true;
  $("hydrationHoverScale").value=Math.min(2.5,Math.max(1.1,Number(settings.hydrationHoverScale)||DEFAULT_HYDRATION_HOVER_SCALE));
  $("hydrationHoverScaleValue").textContent=`${Math.round(Number($("hydrationHoverScale").value)*100)}%`;
  $("screenScale").value=Math.min(1.2,Math.max(.8,Number(settings.screenScale)||DEFAULT_SCREEN_SCALE));
  $("screenScaleValue").textContent=`${Math.round(Number($("screenScale").value)*100)}%`;
  $("animationEnabled").checked=!!settings.animation;
  $("timerAnimationEnabled").checked=settings.timerAnimation!==false;
  $("lowercaseEnabled").checked=!!settings.lowercase;
  document.body.classList.toggle("lowercase",!!settings.lowercase);
  const syncInput=$("syncServer");
  if(syncInput)syncInput.value=settings.syncServer||"";
  setSettingsTab("questions");
  applyHydrationAppearance();
  applyScreenScale();
  updateHydrationHistoryUI();
  applyAppearance();
  renderQuestionEditor();
}
function openSettings(){renderSettings();$("settingsPanel").classList.add("open");}
function closeSettings(){$("settingsPanel").classList.remove("open")}
function setSettingsTab(tab){
  const validTabs=["questions","appearance","reminders","data"];
  const activeTab=validTabs.includes(tab)?tab:"questions";
  const inner=document.querySelector(".settingsInner");
  if(inner)inner.dataset.settingsCategory=activeTab;
  document.querySelectorAll(".settingsTab").forEach(button=>{
    const active=button.dataset.settingsTab===activeTab;
    button.classList.toggle("active",active);
    button.setAttribute("aria-selected",String(active));
  });
}
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
// ---- day circle (time scheduler) mode --------------------------------
const SCHEDULE_KEY="oneQuestionSchedule";
const SCHEDULER_PALETTE=["#7d8c7c","#8c7d8c","#7c829c","#9c8d7c","#7c9c95","#9c7c86"];
const schedulerBlocks=(()=>{
  try{
    const saved=JSON.parse(localStorage.getItem(SCHEDULE_KEY)||"[]");
    return Array.isArray(saved)?saved.filter(b=>Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.label).map(b=>({start:b.start,end:b.end,label:String(b.label),color:String(b.color||SCHEDULER_PALETTE[0])})).filter(b=>b.end>b.start&&b.start>=-720&&b.end<=2880):[];
  }catch{return[]}
})();
function saveSchedule(){cacheSet(SCHEDULE_KEY,schedulerBlocks)}
let schedulerSelection=null; // {start,end,label,color} being drawn or edited
let schedulerEditingIndex=-1; // -1 while drawing a new block
let schedulerDrag=null; // {startMin} while dragging on the ring

const SCHED={cx:200,cy:200,rOuter:170,rInner:118};
function schedPoint(min,r){
  // noon (12:00) at the top, midnight (00:00) at the bottom
  const a=(((min-720)/1440)%1+1)%1*Math.PI*2;
  return [SCHED.cx+r*Math.sin(a),SCHED.cy-r*Math.cos(a)];
}
function wedgePath(start,end,rOuter=SCHED.rOuter,rInner=SCHED.rInner){
  const s=Math.max(-720,Math.min(start,1439.9)),e=Math.max(s+.01,Math.min(end,2160));
  const [x1,y1]=schedPoint(s,rOuter),[x2,y2]=schedPoint(e,rOuter);
  const [x3,y3]=schedPoint(e,rInner),[x4,y4]=schedPoint(s,rInner);
  const large=(e-s)>720?1:0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${rOuter} ${rOuter} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L${x3.toFixed(2)} ${y3.toFixed(2)} A${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}
// a block may cross midnight (e.g. 23:00–01:00); split it into two arcs
function wedgePaths(start,end,rOuter=SCHED.rOuter,rInner=SCHED.rInner){
  const ds=[];
  let s=start,e=end;
  if(e-s>=1440){ds.push(wedgePath(0,1440,rOuter,rInner));return ds;}
  if(s<0){ds.push(wedgePath(s+1440,1440,rOuter,rInner));s=0;}
  if(e>1440){ds.push(wedgePath(0,e-1440,rOuter,rInner));e=1440;}
  if(e-s>=1)ds.push(wedgePath(s,e,rOuter,rInner));
  return ds;
}
function formatMinutes(min){
  const m=((Math.round(min)%1440)+1440)%1440;
  return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
}
function schedulerEventPoint(e){
  const svg=$("schedulerClock");
  const rect=svg.getBoundingClientRect();
  const x=(e.clientX-rect.left)/rect.width*400-SCHED.cx;
  const y=(e.clientY-rect.top)/rect.height*400-SCHED.cy;
  const r=Math.hypot(x,y);
  let min=Math.atan2(x,-y)/(Math.PI*2)*1440;
  // dial is reversed (noon at top): shift the raw pointer angle by 12h so
  // blocks land where the user actually dragged
  min=(((Math.round(min)+720)%1440)+1440)%1440;
  return {min,inRing:r>=SCHED.rInner-6&&r<=SCHED.rOuter+6};
}
function renderSchedulerTicks(){
  const g=$("schedulerTicks");
  g.textContent="";
  // sparse hour ticks; a bolder tick only at 00 / 06 / 12 / 18
  for(let h=0;h<24;h++){
    const major=h%6===0;
    const [x1,y1]=schedPoint(h*60,SCHED.rOuter-2);
    const [x2,y2]=schedPoint(h*60,major?SCHED.rOuter-18:SCHED.rOuter-10);
    const line=document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1",x1.toFixed(1));line.setAttribute("y1",y1.toFixed(1));
    line.setAttribute("x2",x2.toFixed(1));line.setAttribute("y2",y2.toFixed(1));
    line.setAttribute("class",major?"schedTickMajor":"schedTickMinor");
    g.append(line);
  }
  // only the four anchors get a numeral
  for(const h of [0,6,12,18]){
    const [tx,ty]=schedPoint(h*60,SCHED.rOuter-32);
    const text=document.createElementNS("http://www.w3.org/2000/svg","text");
    text.setAttribute("x",tx.toFixed(1));text.setAttribute("y",ty.toFixed(1));
    text.setAttribute("class","schedHourLabel schedHourBig");
    text.setAttribute("text-anchor","middle");
    text.setAttribute("dominant-baseline","middle");
    text.textContent=String(h).padStart(2,"0");
    g.append(text);
  }
}
function schedulerSorted(){return schedulerBlocks.map((b,i)=>({...b,i})).sort((a,b)=>a.start-b.start)}
function renderScheduler(){
  if(!$("schedulerClock"))return;
  renderSchedulerTicks();
  const g=$("schedulerWedges");
  g.textContent="";
  schedulerSorted().forEach(b=>{
    const group=document.createElementNS("http://www.w3.org/2000/svg","g");
    group.setAttribute("data-block-index",String(b.i));
    group.setAttribute("class","schedBlock");
    const now=new Date();
    const nowMin=now.getHours()*60+now.getMinutes();
    const active=(nowMin>=b.start&&nowMin<b.end)||(nowMin+1440>=b.start&&nowMin+1440<b.end);
    if(active)group.setAttribute("data-now","1");
    wedgePaths(b.start,b.end).forEach(d=>{
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",d);
      path.setAttribute("fill",b.color);
      path.setAttribute("stroke",b.color);
      path.setAttribute("class","schedWedge");
      path.dataset.tip=`${b.label} · ${formatMinutes(b.start)} – ${formatMinutes(b.end)}`;
      group.append(path);
    });
    const label=document.createElementNS("http://www.w3.org/2000/svg","title");
    label.textContent=`${formatMinutes(b.start)}–${formatMinutes(b.end)} ${b.label}`;
    group.append(label);
    g.append(group);
  });
  updateSchedulerDrag();
  updateSchedulerNow();
  updateSchedulerCenter();
  renderScheduleList();
}
function renderScheduleList(){
  const list=$("scheduleList");
  if(!list)return;
  list.textContent="";
  const blocks=schedulerSorted();
  if(!blocks.length){
    const empty=document.createElement("div");
    empty.className="scheduleListEmpty";
    empty.textContent="nothing planned yet — drag on the clock";
    list.append(empty);
    return;
  }
  const now=new Date();
  const nowMin=now.getHours()*60+now.getMinutes();
  blocks.forEach(b=>{
    const active=(nowMin>=b.start&&nowMin<b.end)||(nowMin+1440>=b.start&&nowMin+1440<b.end);
    const item=document.createElement("button");
    item.type="button";
    item.className="scheduleListItem"+(active?" now":"");
    const dot=document.createElement("span");dot.className="scheduleListDot";dot.style.background=b.color;
    const time=document.createElement("span");time.className="scheduleListTime";time.textContent=`${formatMinutes(b.start)} – ${formatMinutes(b.end)}`;
    const label=document.createElement("span");label.className="scheduleListLabel";label.textContent=b.label;
    const dur=document.createElement("span");dur.className="scheduleListDuration";dur.textContent=formatDuration(b.end-b.start);
    item.append(dot,time,label,dur);
    item.title=`${b.label} · ${Math.round(b.end-b.start)} min — click to edit`;
    item.onclick=()=>openSchedulerEditor(b.i);
    list.append(item);
  });
}
// small clock preview shown in the reflection mode: wedges + hands + time
function renderMiniClock(){
  const wrap=$("miniClock");
  if(!wrap)return;
  const svg=wrap.querySelector("svg");
  if(!svg)return;
  const NS="http://www.w3.org/2000/svg";
  svg.textContent="";
  const el=(tag,attrs)=>{const n=document.createElementNS(NS,tag);for(const k in attrs)n.setAttribute(k,attrs[k]);svg.append(n);return n;};
  el("circle",{cx:200,cy:200,r:186,class:"miniBezel"});
  for(let h=0;h<24;h++){
    const [x1,y1]=schedPoint(h*60,182),[x2,y2]=schedPoint(h*60,h%6===0?158:168);
    el("line",{x1:x1.toFixed(1),y1:y1.toFixed(1),x2:x2.toFixed(1),y2:y2.toFixed(1),class:h%6===0?"miniTickBig":"miniTick"});
  }
  schedulerBlocks.forEach(b=>{
    const tip=`${b.label} · ${formatMinutes(b.start)} – ${formatMinutes(b.end)}`;
    wedgePaths(b.start,b.end).forEach(d=>{
      const p=el("path",{d,fill:b.color,class:"miniWedge"});
      const t=document.createElementNS(NS,"title");
      t.textContent=tip;
      p.append(t);
      p.dataset.tip=tip;
    });
  });
  const now=new Date();
  const nowMin=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
  const minuteMin=now.getMinutes()+now.getSeconds()/60;
  const hand=(angleMin,len,width)=>{
    const [sx,sy]=schedPoint(angleMin,40),[tx,ty]=schedPoint(angleMin,len);
    el("line",{x1:sx.toFixed(1),y1:sy.toFixed(1),x2:tx.toFixed(1),y2:ty.toFixed(1),class:width});
  };
  hand(nowMin,120,"miniHourHand");
  hand(minuteMin*24+720,168,"miniMinuteHand");
  el("circle",{cx:200,cy:200,r:14,class:"miniCap"});
  const timeLabel=$("miniClockTime");
  if(timeLabel)timeLabel.textContent=now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
}
function updateSchedulerDrag(){
  const g=$("schedulerDrag");
  g.textContent="";
  if(!schedulerDrag)return;
  const start=Math.min(schedulerDrag.start,schedulerDrag.cur);
  const end=Math.max(schedulerDrag.start,schedulerDrag.cur);
  wedgePaths(start,end).forEach(d=>{
    const path=document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d",d);
    path.setAttribute("class","schedWedgeDrag");
    g.append(path);
  });
}
function updateSchedulerNow(){
  const now=new Date();
  const nowMin=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
  const minuteMin=now.getMinutes()+now.getSeconds()/60;
  const secondMin=now.getSeconds();
  // use the same angle helper as the dial ticks so hands always line up
  // with the printed hours: the hour hand points at "now" on the 24h dial
  // (one revolution per day), the minute hand turns once per hour
  // and the second hand turns once per minute
  const setHand=(id,angleMin,len)=>{
    const hand=$(id);
    if(!hand)return;
    const [sx,sy]=schedPoint(angleMin,92);
    const [tx,ty]=schedPoint(angleMin,len);
    hand.setAttribute("x1",sx.toFixed(2));hand.setAttribute("y1",sy.toFixed(2));
    hand.setAttribute("x2",tx.toFixed(2));hand.setAttribute("y2",ty.toFixed(2));
  };
  setHand("schedulerHourHand",nowMin,132);
  setHand("schedulerMinuteHand",minuteMin*24+720,162);
  setHand("schedulerSecondHand",secondMin*24+720,172);
}
function formatDuration(min){
  const m=Math.max(0,Math.ceil(min));
  const h=Math.floor(m/60),r=m%60;
  if(!h)return `${m}m`;
  return r?`${h}h ${r}m`:`${h}h`;
}
function formatHMS(totalSec){
  const s=Math.max(0,Math.floor(totalSec));
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
let schedulerLastBlockKey=null; // key of the active block, to detect time changes
let schedulerAlarmCtx=null;
// unlock the alarm audio on the first user interaction (browsers block
// sound until a gesture happens)
["pointerdown","keydown"].forEach(evt=>document.addEventListener(evt,()=>{
  if(!schedulerAlarmCtx)schedulerAlarmCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(schedulerAlarmCtx.state==="suspended")schedulerAlarmCtx.resume();
},{capture:true}));
// classic digital clock alarm: beep beep beep … beep beep beep
function playSchedulerAlarm(){
  try{
    if(!schedulerAlarmCtx)schedulerAlarmCtx=new (window.AudioContext||window.webkitAudioContext)();
    if(schedulerAlarmCtx.state==="suspended")schedulerAlarmCtx.resume();
    const ctx=schedulerAlarmCtx,t0=ctx.currentTime+0.05;
    // classic piezo digital clock alarm: sharp ~2kHz square bursts,
    // staccato on/off like a real alarm clock buzzer
    const beepAt=start=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type="square";osc.frequency.value=2000;
      gain.gain.setValueAtTime(0.12,start);
      gain.gain.setValueAtTime(0.0001,start+0.085);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);osc.stop(start+0.09);
    };
    const burst=base=>{for(let i=0;i<3;i++)beepAt(base+i*0.14)};
    burst(t0);        // beep beep beep
    burst(t0+0.6);    // beep beep beep (x2)
  }catch{}
}
function updateSchedulerCenter(){
  const now=new Date();
  const min=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
  const blocks=schedulerSorted();
  const current=blocks.find(b=>(min>=b.start&&min<b.end)||(min+1440>=b.start&&min+1440<b.end));
  if(currentMode==="scheduler"){
    const key=current?`${current.start}-${current.end}-${current.label}`:"free";
    if(schedulerLastBlockKey!==null&&key!==schedulerLastBlockKey)playSchedulerAlarm();
    schedulerLastBlockKey=key;
  }
  const next=blocks.find(b=>b.start>min);
  if(current){
    // countdown: time left in the active block
    const refMin=min+1440>=current.start&&min<current.start?min+1440:min;
    setWheelText($("schedulerNowTime"),formatHMS((current.end-refMin)*60));
  }else if(next){
    // free time: countdown until the next block starts
    setWheelText($("schedulerNowTime"),formatHMS((next.start-min)*60));
  }else{
    setWheelText($("schedulerNowTime"),now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}));
  }
  $("schedulerCurrent").textContent=current?current.label:"free time";
  $("schedulerCurrent").style.color=current?current.color:"";
  $("schedulerNext").textContent=current
    ?`ends at ${formatMinutes(current.end)}${next?` · next: ${next.label} at ${formatMinutes(next.start)}`:""}`
    :next?`next: ${next.label} at ${formatMinutes(next.start)}`:"nothing planned next";
}
function closeSchedulerEditor(){
  schedulerSelection=null;schedulerEditingIndex=-1;
  const ed=$("schedulerEditor");
  ed.classList.remove("open");ed.setAttribute("aria-hidden","true");
}
function parseTimeInput(value,fallback){
  const m=/^(\d{1,2}):(\d{2})$/.exec(String(value||"").trim());
  if(!m)return fallback;
  const min=Number(m[1])*60+Number(m[2]);
  return Number.isFinite(min)?min:fallback;
}
function openSchedulerEditor(index=-1,selection=null){
  schedulerEditingIndex=index;
  schedulerSelection=index>=0?{...schedulerBlocks[index]}:selection;
  const ed=$("schedulerEditor");
  ed.classList.add("open");ed.setAttribute("aria-hidden","false");
  $("schedulerStart").value=formatMinutes(schedulerSelection.start);
  $("schedulerEnd").value=formatMinutes(schedulerSelection.end);
  syncEditorTimes();
  $("schedulerLabel").value=schedulerSelection.label||"";
  renderSchedulerColors();
  $("schedulerDelete").style.display=index>=0?"":"none";
  $("schedulerLabel").focus();
}
function renderSchedulerColors(){
  const wrap=$("schedulerColors");
  wrap.textContent="";
  SCHEDULER_PALETTE.forEach(color=>{
    const b=document.createElement("button");
    b.type="button";b.className="schedulerColor"+(schedulerSelection&&schedulerSelection.color===color?" active":"");
    b.style.background=color;b.setAttribute("aria-label",`color ${color}`);
    b.onclick=()=>{schedulerSelection.color=color;renderSchedulerColors();previewSchedulerSelection();};
    wrap.append(b);
  });
}
function previewSchedulerSelection(){
  const g=$("schedulerDrag");
  g.textContent="";
  if(!schedulerSelection)return;
  wedgePaths(schedulerSelection.start,schedulerSelection.end).forEach(d=>{
    const path=document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d",d);
    path.setAttribute("fill",schedulerSelection.color);
    path.setAttribute("stroke",schedulerSelection.color);
    path.setAttribute("class","schedWedgeDrag");
    g.append(path);
  });
}
// keep the range text, the preview wedge and the selection in sync while
// the user edits the exact from/to times
function syncEditorTimes(){
  if(!schedulerSelection)return;
  const start=parseTimeInput($("schedulerStart").value,schedulerSelection.start);
  let end=parseTimeInput($("schedulerEnd").value,schedulerSelection.end);
  const startNorm=((start%1440)+1440)%1440;
  let endNorm=((end%1440)+1440)%1440;
  if(endNorm<=startNorm)endNorm+=1440;
  schedulerSelection={...schedulerSelection,start:startNorm,end:endNorm};
  $("schedulerEditorTime").textContent=`${formatMinutes(startNorm)} – ${formatMinutes(endNorm)} (${Math.round(endNorm-startNorm)} min)`;
  previewSchedulerSelection();
}
function commitSchedulerBlock(){
  if(!schedulerSelection)return;
  syncEditorTimes();
  const label=$("schedulerLabel").value.trim()||"unnamed";
  const block={...schedulerSelection,label};
  if(schedulerEditingIndex>=0)schedulerBlocks[schedulerEditingIndex]=block;
  else schedulerBlocks.push(block);
  saveSchedule();closeSchedulerEditor();renderScheduler();
}
function deleteSchedulerBlock(){
  if(schedulerEditingIndex>=0)schedulerBlocks.splice(schedulerEditingIndex,1);
  saveSchedule();closeSchedulerEditor();renderScheduler();
}
function initSchedulerMode(){
  const svg=$("schedulerClock");
  if(!svg)return;
  renderScheduler();
  svg.addEventListener("pointerdown",e=>{
    if(schedulerSelection){closeSchedulerEditor();renderScheduler();}
    const p=schedulerEventPoint(e);
    if(!p.inRing)return;
    try{svg.setPointerCapture(e.pointerId);}catch{}
    schedulerDrag={start:p.min,cur:p.min};
    updateSchedulerDrag();
  });
  svg.addEventListener("pointermove",e=>{
    if(!schedulerDrag)return;
    const p=schedulerEventPoint(e);
    if(p.inRing||e.buttons){schedulerDrag.cur=p.min;updateSchedulerDrag();}
  });
  svg.addEventListener("pointerup",e=>{
    if(!schedulerDrag)return;
    const start=Math.min(schedulerDrag.start,schedulerDrag.cur);
    let end=Math.max(schedulerDrag.start,schedulerDrag.cur);
    schedulerDrag=null;
    if(end-start<10){
      // pointer capture swallows the click, so find the wedge by position
      updateSchedulerDrag();
      const el=document.elementFromPoint(e.clientX,e.clientY);
      const group=el&&el.closest?el.closest("[data-block-index]"):null;
      if(group)openSchedulerEditor(Number(group.dataset.blockIndex));
      return;
    }
    // wrap around midnight when dragging across 00:00
    let s=start,en=end;
    if(end-start>720){s=end-1440;en=start;}
    openSchedulerEditor(-1,{start:Math.round(s),end:Math.round(en),label:"",color:SCHEDULER_PALETTE[schedulerBlocks.length%SCHEDULER_PALETTE.length]});
  });
  svg.addEventListener("pointercancel",()=>{schedulerDrag=null;updateSchedulerDrag();});
  $("schedulerSave").onclick=commitSchedulerBlock;
  $("schedulerDelete").onclick=deleteSchedulerBlock;
  $("schedulerCancel").onclick=()=>{closeSchedulerEditor();renderScheduler();};
  $("schedulerStart").addEventListener("input",syncEditorTimes);
  $("schedulerEnd").addEventListener("input",syncEditorTimes);
  $("schedulerLabel").addEventListener("keydown",e=>{
    if(e.key==="Enter"){e.preventDefault();commitSchedulerBlock();}
    else if(e.key==="Escape"){e.preventDefault();closeSchedulerEditor();renderScheduler();}
  });
  $("miniClock")?.addEventListener("click",()=>{if(currentMode!=="scheduler")enterSchedulerMode();});
  // shared styled tooltip: block name over a wedge, current time otherwise
  let tipEl=null;
  const hideTip=()=>{if(tipEl){tipEl.remove();tipEl=null;}};
  const showTip=(text,x,y)=>{
    tipEl=document.createElement("div");
    tipEl.className="miniClockTooltip";
    tipEl.textContent=text;
    document.body.append(tipEl);
    const r=tipEl.getBoundingClientRect();
    tipEl.style.left=`${Math.min(window.innerWidth-r.width-8,x+12)}px`;
    tipEl.style.top=`${Math.max(8,y-r.height-10)}px`;
  };
  const nowInfo=()=>{
    const now=new Date();
    const min=now.getHours()*60+now.getMinutes();
    const blocks=schedulerSorted();
    const current=blocks.find(b=>(min>=b.start&&min<b.end)||(min+1440>=b.start&&min+1440<b.end));
    return `now ${now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}${current?` · ${current.label}`:""}`;
  };
  const bindTooltip=(container,fallback)=>{
    if(!container)return;
    container.addEventListener("pointermove",e=>{
      const path=e.target.closest&&e.target.closest("[data-tip]");
      const text=path&&path.dataset.tip?path.dataset.tip:fallback();
      if(tipEl&&tipEl.textContent===text)return;
      hideTip();
      showTip(text,e.clientX,e.clientY);
    });
    container.addEventListener("pointerleave",hideTip);
    container.addEventListener("pointerdown",hideTip);
  };
  const mini=$("miniClock");
  if(mini)bindTooltip(mini,nowInfo);
  bindTooltip($("schedulerClock"),nowInfo);
  // schedule list show/hide — clock centers when the list is hidden
  const applyListVisibility=()=>{
    document.body.classList.toggle("schedulerListHidden",settings.schedulerListVisible===false);
    const t=$("scheduleListToggle");
    if(t)t.setAttribute("aria-pressed",String(settings.schedulerListVisible!==false));
  };
  $("scheduleListToggle")?.addEventListener("click",()=>{
    settings.schedulerListVisible=settings.schedulerListVisible===false;
    saveSettings();
    applyListVisibility();
  });
  applyListVisibility();
  renderMiniClock();
  // remember wall: input + always-visible rotating pin
  const addFromInput=()=>{
    const input=$("stickyInput");
    if(input&&addSticky(input.value))input.value="";
  };
  $("stickyAdd")?.addEventListener("click",addFromInput);
  $("stickyInput")?.addEventListener("keydown",e=>{
    if(e.key==="Enter"){e.preventDefault();addFromInput();}
    else if(e.key==="Escape"){e.preventDefault();enterQuestionMode();}
  });
  $("stickyPin")?.addEventListener("click",()=>{if(currentMode!=="sticky")enterStickyMode();});
  renderStickyPin();
  setInterval(()=>{
    const pending=stickies.filter(s=>!s.done);
    if(pending.length){stickyPinIndex=(stickyPinIndex+1)%pending.length;renderStickyPin();}
  },8000);
  let lastListMinute=-1;
  setInterval(()=>{
    updateSchedulerNow();updateSchedulerCenter();renderMiniClock();
    if(currentMode==="scheduler"){
      const m=new Date().getMinutes();
      if(m!==lastListMinute){lastListMinute=m;renderScheduleList();}
    }
  },1000);
}
function enterSchedulerMode(){
  clearTimeout(cycleTimer);closeCategoryMenu();
  currentMode="scheduler";cyclePaused=false;isAnswering=false;
  document.body.classList.remove("focusModeVisual");
  updateModeUI();updateFocusUI();
  setCycleStatus("day circle",false);
  answerEl.blur();
}
// ---- remember wall (sticky notes) mode --------------------------------
const STICKY_KEY="oneQuestionStickies";
const stickies=(()=>{
  try{
    const saved=JSON.parse(localStorage.getItem(STICKY_KEY)||"[]");
    return Array.isArray(saved)?saved.filter(s=>s&&typeof s.text==="string"&&s.text.trim()).map((s,i)=>({id:String(s.id||crypto.randomUUID()),text:s.text.trim(),created:Number(s.created)||Date.now(),done:!!s.done})):[];
  }catch{return[]}
})();
function saveStickies(){cacheSet(STICKY_KEY,stickies)}
let stickyPinIndex=0;
let stickyZ=10;
function defaultStickyPos(i){
  return {x:6+(i*37)%58,y:8+(i*29)%52};
}
function stickyTilt(s){
  const n=[...s.id].reduce((a,c)=>a+c.charCodeAt(0),s.text.length);
  return (n%7-3)*.6;
}
function renderStickies(){
  const list=$("stickyList");
  if(!list)return;
  list.textContent="";
  const pending=stickies.filter(s=>!s.done);
  if(!pending.length){
    const empty=document.createElement("div");
    empty.className="stickyEmpty";
    empty.textContent=stickies.length?"everything is handled — nothing pressing":"nothing here yet. capture the thing you keep forgetting.";
    list.append(empty);
  }
  pending.forEach((s,i)=>{
    const pos=s.x==null||s.y==null?defaultStickyPos(i):s;
    const card=document.createElement("div");
    card.className="stickyFloat";
    card.style.left=`${pos.x}%`;
    card.style.top=`${pos.y}%`;
    card.style.zIndex=s.z||++stickyZ;
    card.style.setProperty("--tilt",`${stickyTilt(s)}deg`);
    const text=document.createElement("div");text.className="stickyNoteText";text.textContent=s.text;
    const meta=document.createElement("div");meta.className="stickyNoteAge";
    const days=Math.floor((Date.now()-s.created)/86400000);
    meta.textContent=days>0?`${days}d ago`:"today";
    const actions=document.createElement("div");actions.className="stickyActions";
    const doneBtn=document.createElement("button");doneBtn.type="button";doneBtn.className="stickyBtn";doneBtn.textContent="✓";
    doneBtn.title="mark as handled";
    doneBtn.onclick=e=>{e.stopPropagation();s.done=true;saveStickies();renderStickies();renderStickyPin();};
    const delBtn=document.createElement("button");delBtn.type="button";delBtn.className="stickyBtn stickyBtnDel";delBtn.textContent="×";
    delBtn.title="delete note";
    delBtn.onclick=e=>{e.stopPropagation();stickies.splice(stickies.indexOf(s),1);saveStickies();renderStickies();renderStickyPin();};
    actions.append(doneBtn,delBtn);
    card.append(actions,text,meta);
    // drag anywhere — position is the reorder
    card.addEventListener("pointerdown",e=>{
      if(e.target.closest("button"))return;
      try{card.setPointerCapture(e.pointerId);}catch{}
      card.style.zIndex=++stickyZ;
      s.z=card.style.zIndex;
      const rect=list.getBoundingClientRect();
      const cardRect=card.getBoundingClientRect();
      const grabX=e.clientX-cardRect.left,grabY=e.clientY-cardRect.top;
      card.classList.add("dragging");
      const move=ev=>{
        const x=Math.max(0,Math.min(rect.width-cardRect.width,ev.clientX-rect.left-grabX));
        const y=Math.max(0,Math.min(rect.height-cardRect.height,ev.clientY-rect.top-grabY));
        card.style.left=`${x}px`;
        card.style.top=`${y}px`;
      };
      const up=()=>{
        card.classList.remove("dragging");
        card.removeEventListener("pointermove",move);
        card.removeEventListener("pointerup",up);
        card.removeEventListener("pointercancel",up);
        s.x=Math.round(card.offsetLeft/rect.width*1000)/10;
        s.y=Math.round(card.offsetTop/rect.height*1000)/10;
        saveStickies();
      };
      card.addEventListener("pointermove",move);
      card.addEventListener("pointerup",up);
      card.addEventListener("pointercancel",up);
    });
    list.append(card);
  });
  // handled notes: quiet footer with restore
  const done=stickies.filter(s=>s.done);
  if(done.length){
    const head=document.createElement("button");
    head.type="button";head.className="stickyDoneHead";
    head.textContent=`handled (${done.length})`;
    head.onclick=()=>{head.parentElement.classList.toggle("showDone");};
    list.append(head);
    const wrap=document.createElement("div");wrap.className="stickyDoneWrap";
    done.slice(-8).reverse().forEach(s=>{
      const row=document.createElement("button");
      row.type="button";row.className="stickyDoneRow";
      row.textContent=s.text;
      row.title="bring it back";
      row.onclick=()=>{s.done=false;saveStickies();renderStickies();renderStickyPin();};
      wrap.append(row);
    });
    list.append(wrap);
  }
}
function addSticky(text){
  const clean=String(text||"").trim();
  if(!clean)return false;
  stickies.unshift({id:crypto.randomUUID(),text:clean,created:Date.now(),done:false});
  saveStickies();renderStickies();renderStickyPin();
  return true;
}
function renderStickyPin(){
  const pin=$("stickyPin"),text=$("stickyPinText");
  if(!pin||!text)return;
  const pending=stickies.filter(s=>!s.done);
  pin.classList.toggle("hasNotes",pending.length>0);
  if(!pending.length){text.textContent="";pin.title="remember wall";return;}
  stickyPinIndex=stickyPinIndex%pending.length;
  text.textContent=pending[stickyPinIndex].text;
  pin.title=`remember (${pending.length}) — click to open`;
}
function enterStickyMode(){
  clearTimeout(cycleTimer);closeCategoryMenu();
  currentMode="sticky";cyclePaused=false;isAnswering=false;
  document.body.classList.remove("focusModeVisual");
  updateModeUI();updateFocusUI();
  setCycleStatus("remember",false);
  answerEl.blur();
  $("stickyInput")?.focus();
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
$("todoDock").onclick=openToday;

$("modeToggle").onclick=e=>toggleModeMenu(e);
$("lowercaseEnabled").addEventListener("change",e=>{settings.lowercase=e.target.checked;saveSettings();});
$("syncServer")?.addEventListener("change",e=>{
  settings.syncServer=e.target.value.trim();
  saveSettings();
  pushSyncToServer();
});
$("noteDock").addEventListener("click",e=>{e.preventDefault();e.stopPropagation();toggleNote();});
$("noteText")?.addEventListener("input",e=>saveNote(e.target.value));
document.querySelectorAll(".timerMode").forEach(b=>b.onclick=()=>setTimerMode(b.dataset.timer));
$("focusTimerStart").onclick=toggleTimer;
$("focusTimerReset").onclick=resetTimer;
$("focusTimerPnp").onclick=()=>{try{document.documentElement.requestPictureInPicture?.()}catch{}};


$("closeSettings").onclick=closeSettings;
$("settingsPanel").addEventListener("click",e=>{if(e.target===$("settingsPanel"))closeSettings()});
document.querySelectorAll(".settingsTab").forEach(button=>button.addEventListener("click",()=>setSettingsTab(button.dataset.settingsTab)));

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
["hydrationHours","hydrationMinutesPart","hydrationSeconds"].forEach(id=>$(id).addEventListener("change",updateHydrationDuration));
$("hydrationSize").addEventListener("input",e=>{
  settings.hydrationSize=Math.min(48,Math.max(12,Number(e.target.value)||DEFAULT_HYDRATION_SIZE));
  $("hydrationSizeValue").textContent=`${settings.hydrationSize}px`;
  saveSettings();
  applyHydrationAppearance();
});
$("hydrationWave").addEventListener("change",e=>{
  settings.hydrationWave=e.target.checked;
  saveSettings();
  applyHydrationAppearance();
});
$("hydrationHoverEnabled").addEventListener("change",e=>{
  settings.hydrationHoverEnabled=e.target.checked;
  saveSettings();
  applyHydrationAppearance();
});
$("hydrationHoverScale").addEventListener("input",e=>{
  settings.hydrationHoverScale=Math.min(2.5,Math.max(1.1,Number(e.target.value)||DEFAULT_HYDRATION_HOVER_SCALE));
  $("hydrationHoverScaleValue").textContent=`${Math.round(settings.hydrationHoverScale*100)}%`;
  saveSettings();
  applyHydrationAppearance();
});
$("screenScale").addEventListener("input",e=>{
  settings.screenScale=Math.min(1.2,Math.max(.8,Number(e.target.value)||DEFAULT_SCREEN_SCALE));
  $("screenScaleValue").textContent=`${Math.round(settings.screenScale*100)}%`;
  saveSettings();
  applyScreenScale();
});
$("animationEnabled").addEventListener("change",e=>{
  settings.animation=e.target.checked;
  saveSettings();
});
$("timerAnimationEnabled").addEventListener("change",e=>{
  settings.timerAnimation=e.target.checked;
  saveSettings();
  updateTimerUI();
});

[["backgroundColor","backgroundColor"],["textColor","textColor"],["accentColor","accentColor"],["overlayColor","overlayColor"]].forEach(([id,key])=>{
  $(id).addEventListener("input",e=>updateAppearanceValue(key,e.target.value));
});
[["backgroundOpacity","backgroundOpacity"],["overlayOpacity","overlayOpacity"],["backgroundBlur","blur"],["backgroundGrayscale","grayscale"],["backgroundSaturation","saturation"],["backgroundBrightness","brightness"],["backgroundContrast","contrast"],["backgroundSepia","sepia"],["parallaxText","parallaxText"],["parallaxBackground","parallaxBackground"],["parallaxScale","parallaxScale"],["textSize","textSize"],["fontWeight","fontWeight"]].forEach(([id,key])=>{
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
const lightModeToggle=$("lightModeEnabled");
if(lightModeToggle)lightModeToggle.addEventListener("change",()=>setLightMode(lightModeToggle.checked));
const themeToggleBtn=$("themeToggle");
if(themeToggleBtn)themeToggleBtn.addEventListener("click",()=>setLightMode(!settings.appearance.lightMode));
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
$("todoDock").onclick=()=>{
  if($("todoFullscreen").classList.contains("open")) closeToday();
  else openToday();
};
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
  if(schedulerSelection){closeSchedulerEditor();renderScheduler();return;}
  if(currentMode==="sticky"){enterQuestionMode();return;}
  if($("historyPanel").classList.contains("open")){closeHistory();return;}
  closeCategoryMenu();
});

applyAppearance();
dateEl.textContent=new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(new Date());
restoreTimerState();
if(timerRunning)timerInterval=setInterval(tickTimer,1000);
renderTodos();
renderCalendar();
initSchedulerMode();
updateModeUI();
updateCycleToggle();
initHydrationReminder();
loadNote();

const initial=chooseFreshIndex();
viewedQuestions=[initial];
viewedPosition=0;
renderQuestion(initial);
focusEl.classList.add("questionIn");
setTimeout(()=>focusEl.classList.remove("questionIn"),1100);
startCycle();

pullSyncFromServer();
hydrateBrowserStorage().then(()=>{
  questions=loadQuestionBank();
  focusQuestions=loadFocusQuestions();
  settings=loadSettings();
  if(Object.keys(wallpaperEngineProperties).length) applyWallpaperEngineProperties(wallpaperEngineProperties);
  renderSettings();
  renderTodos();
  applyAppearance();
  loadNote();
  const refreshed=chooseFreshIndex();
  viewedQuestions=[refreshed];
  viewedPosition=0;
  renderQuestion(refreshed);
});
