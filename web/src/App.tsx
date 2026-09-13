import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { api, post } from './api'

// Three.js is only needed inside the PID and RL work panels, so it loads on demand.
const RobotScene = lazy(() => import('./RobotScene'))

type LessonId = 'pid' | 'rl' | 'vision'
type Point = { time: number; position: number; target: number; output: number; p: number; i: number; d: number }
type PidResult = { trajectory: Point[]; metrics: { max_error_cm: number; final_error_cm: number; tail_error_cm: number; stable: boolean }; disturbance: { id: string; label: string } }
type VisionModel = { weights: number[][]; bias: number[] }
type Prediction = { label: string; scores: Record<string, number> }
type Job = { id: string; state: string; preset: string; progress: number; trained_steps: number; requested_steps: number; error?: string; result?: { evaluation: EvalResult } }
type EvalResult = { episodes: number; contacts: number; legal_returns: number; outcomes: Record<string, number> }

const lessonMeta = {
  pid: { number: '01', title: 'Keep it steady', subtitle: 'Tune a PID controller so the robot holds its spot through a push.' },
  rl: { number: '02', title: 'Teach a return', subtitle: 'Train a ping-pong policy and test it on serves it never saw.' },
  vision: { number: '03', title: 'Teach it colors', subtitle: 'Label examples, train a classifier, and see where it fails.' },
}
const DISTURBANCES = [['push', 'Quick push'], ['long_push', 'Long push'], ['steady_pull', 'Steady pull']] as const

/** Local-storage backed state. Only small, safe experiment summaries are stored: never raw trajectories or checkpoints. */
function usePersistent<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => { try { const raw = localStorage.getItem(key); return raw ? { ...initial, ...JSON.parse(raw) } : initial } catch { return initial } })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode or quota: keep working without persistence */ } }, [key, value])
  return [value, setValue] as const
}

export default function App() {
  const [lesson, setLesson] = useState<LessonId | null>(null)
  const [progress, setProgress] = usePersistent<Record<LessonId, number>>('bracket-progress', { pid: 0, rl: 0, vision: 0 })
  const advance = useCallback((id: LessonId, stage: number) => setProgress(p => ({ ...p, [id]: Math.max(p[id] || 0, stage) })), [setProgress])
  const advancePid = useCallback((s: number) => advance('pid', s), [advance])
  const advanceRl = useCallback((s: number) => advance('rl', s), [advance])
  const advanceVision = useCallback((s: number) => advance('vision', s), [advance])

  if (!lesson) return <Home progress={progress} open={setLesson} />
  return <main className="lab-shell">
    <Topbar lesson={lesson} back={() => setLesson(null)} />
    {lesson === 'pid' && <PIDLesson stage={progress.pid || 0} advance={advancePid} />}
    {lesson === 'rl' && <RLLesson stage={progress.rl || 0} advance={advanceRl} />}
    {lesson === 'vision' && <VisionLesson stage={progress.vision || 0} advance={advanceVision} />}
  </main>
}

function Topbar({ lesson, back }: { lesson: LessonId; back: () => void }) {
  const meta = lessonMeta[lesson]
  return <header className="topbar">
    <button className="back" onClick={back}>Lab map</button>
    <div className="brand">BracketBot Lab</div>
    <div className="lesson-chip"><b>{meta.number}</b>{meta.title}</div>
  </header>
}

function Home({ progress, open }: { progress: Record<LessonId, number>; open: (id: LessonId) => void }) {
  return <main className="home">
    <section className="hero">
      <header className="home-head"><span className="brand">BracketBot Lab</span><span className="meta">Three labs, about 50 minutes.</span></header>
      <div className="hero-copy"><h1>Make a robot<br/>behave.</h1><p>Three hands-on labs. Change one thing, run the robot, and see what happens.</p><span className="hero-credit">Built on Bracket Bot. No code needed.</span></div>
      <div className="hero-frame"><Suspense fallback={<SceneFallback/>}><RobotScene mode="hero" active/></Suspense></div>
    </section>
    <section className="lessons"><div className="lessons-inner">
      <h2>Three labs, in order.</h2>
      <div className="lesson-grid">
        {(Object.keys(lessonMeta) as LessonId[]).map((id, index) => { const item = lessonMeta[id]; const done = progress[id] >= 5; return <button className="lesson-card" key={id} onClick={() => open(id)}>
          <div className="card-number">{item.number}<span>{done ? 'Complete' : progress[id] ? `Step ${progress[id] + 1} of 5` : 'Ready'}</span></div>
          <h2>{item.title}</h2><p>{item.subtitle}</p>
          <div className="card-progress"><span style={{ width: `${Math.min(progress[id], 5) * 20}%` }}/></div><strong>{done ? 'Open lab' : index === 0 && !progress[id] ? 'Start lab' : progress[id] ? 'Continue' : 'Open lab'}</strong>
        </button> })}
      </div>
    </div></section>
    <footer className="home-foot">Experiments and training stay on this computer.</footer>
  </main>
}

function StageRail({ names, current, set }: { names: string[]; current: number; set: (n: number) => void }) {
  return <nav className="stage-rail" aria-label="Lesson stages">{names.map((name, i) => <button key={name} className={i === current ? 'active' : i < current ? 'done' : ''} onClick={() => set(i)}><span>{i < current ? '✓' : i + 1}</span>{name}</button>)}</nav>
}

/** One final concept question per lesson. The lesson is only marked complete after a correct answer. */
function ConceptCheck({ question, options, answer, done, onPass }: { question: string; options: string[]; answer: number; done: boolean; onPass: () => void }) {
  const [picked, setPicked] = useState<number | null>(done ? answer : null)
  const correct = picked === answer
  return <div className="concept-check" data-testid="concept-check"><b>Check what you learned</b><p>{question}</p>
    <div className="choice-stack">{options.map((option, i) => <button key={option} className={picked === i ? (i === answer ? 'selected' : 'wrong') : ''} disabled={correct} onClick={() => { setPicked(i); if (i === answer) onPass() }}><span>{picked === i ? (i === answer ? '✓' : '✕') : '○'}</span>{option}</button>)}</div>
    {picked !== null && <p className={correct ? 'result-callout' : 'error'}>{correct ? 'Correct. Lesson complete.' : 'Not quite. Think about what you saw in the experiment and try again.'}</p>}
  </div>
}

function SceneFallback() { return <div className="scene scene-loading" role="img" aria-label="Loading 3D simulation"><span>Loading 3D scene…</span></div> }

function PIDLesson({ stage, advance }: { stage: number; advance: (n: number) => void }) {
  const [current, setCurrent] = useState(Math.min(stage, 4))
  const [saved, setSaved] = usePersistent('bracket-pid', { kp: stage ? 3.2 : 0, ki: stage >= 3 ? .35 : 0, kd: stage >= 2 ? 1.1 : 0, challengeGains: '', challenge: {} as Record<string, boolean> })
  const { kp, ki, kd } = saved
  const setGain = (key: 'kp' | 'ki' | 'kd') => (value: number) => setSaved(s => ({ ...s, [key]: value }))
  const [disturbance, setDisturbance] = useState<string>('push'); const [result, setResult] = useState<PidResult | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [frame, setFrame] = useState(0)
  const gainsKey = `${kp}|${ki}|${kd}`
  const challenge = saved.challengeGains === gainsKey ? saved.challenge : {}
  const challengePassed = DISTURBANCES.every(([id]) => challenge[id])
  const run = async () => {
    setLoading(true); setError('')
    try {
      const data = await post<PidResult>('/api/pid/run', { kp, ki, kd, disturbance }); setResult(data); setFrame(0)
      if (current < 4) { advance(current + 1); setCurrent(current + 1) }
      else setSaved(s => ({ ...s, challengeGains: gainsKey, challenge: { ...(s.challengeGains === gainsKey ? s.challenge : {}), [disturbance]: data.metrics.stable } }))
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { if (!result) return; let id = 0; const tick = () => { setFrame(f => f >= result.trajectory.length - 1 ? f : f + 1); id = requestAnimationFrame(tick) }; id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id) }, [result])
  const descriptions = [
    ['See the error.', 'Turn correction off and watch what a push does. A controller starts by measuring the gap between the target and the robot.'],
    ['Tune P.', 'P reacts to the error right now. More P means a stronger correction, but too much can overshoot.'],
    ['Add D.', 'D watches how quickly the robot is moving. It adds damping, like a hand slowing a swinging door.'],
    ['Add I.', 'I remembers small errors over time. Try it against a steady pull that never goes away.'],
    ['Controller challenge.', 'Choose one set of gains that recovers from all three disturbances. Keep the robot within 5 cm for the final two seconds of each run. Changing a gain restarts the challenge.'],
  ]
  return <LessonLayout rail={<StageRail names={['See the error','Tune P','Add D','Add I','Challenge']} current={current} set={setCurrent}/>}>
    <section className="work-panel"><Suspense fallback={<SceneFallback/>}><RobotScene mode="pid" position={result?.trajectory[frame]?.position || 0} active={loading}/></Suspense><div className="scene-label"><span>Live simulation</span><b>{result ? `${result.disturbance.label}, ${result.metrics.stable ? 'stable' : 'try again'}` : 'Target: 0.00 m'}</b></div></section>
    <aside className="control-panel"><p className="step">Step {current + 1} of 5</p><h1>{descriptions[current][0]}</h1><p>{descriptions[current][1]}</p>
      <div className="control-group"><Range label="Correction strength" symbol="P" value={kp} max={8} step={.1} set={setGain('kp')}/>{current >= 2 && <Range label="Damping" symbol="D" value={kd} max={4} step={.05} set={setGain('kd')}/>} {current >= 3 && <Range label="Persistent correction" symbol="I" value={ki} max={2} step={.05} set={setGain('ki')}/>}</div>
      <label className="select-label">Disturbance<select value={disturbance} onChange={e => setDisturbance(e.target.value)}>{DISTURBANCES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <button className="primary" onClick={run} disabled={loading}>{loading ? 'Running MuJoCo…' : 'Run experiment'}</button>{error && <p className="error">{error}</p>}
      {current === 4 && <div className="challenge-board" data-testid="challenge-board">{DISTURBANCES.map(([id, label]) => <span key={id} className={challenge[id] ? 'good' : id in challenge ? 'warn' : ''}>{challenge[id] ? '✓' : id in challenge ? '✕' : '○'} {label}</span>)}</div>}
      {result && <><MetricStrip result={result}/><LineChart points={result.trajectory}/></>}
      {current === 4 && (challengePassed || stage >= 5) && <ConceptCheck done={stage >= 5} onPass={() => advance(5)} question="The robot slowly drifts and never quite returns to the target during a steady pull. Which term is designed to fix that?" options={['P: react to the error right now', 'I: add up small errors over time', 'D: slow down fast movement']} answer={1}/>}
    </aside>
  </LessonLayout>
}

function Range({ label, symbol, value, max, step, set }: { label:string; symbol:string; value:number; max:number; step:number; set:(n:number)=>void }) {
  return <label className="range"><div><span><i>{symbol}</i>{label}</span><output>{value.toFixed(2)}</output></div><input type="range" min="0" max={max} step={step} value={value} onChange={e => set(+e.target.value)}/></label>
}
function MetricStrip({ result }: { result: PidResult }) { return <div className="metrics"><div><b>{result.metrics.max_error_cm}</b><span>cm max error</span></div><div><b>{result.metrics.final_error_cm}</b><span>cm final error</span></div><div className={result.metrics.stable ? 'good' : 'warn'}><b>{result.metrics.stable ? 'Pass' : 'Tune'}</b><span>last 2 seconds</span></div></div> }
function LineChart({ points }: { points: Point[] }) { const path = points.map((p,i)=>`${i?'L':'M'} ${i/(points.length-1)*300} ${60-p.position*220}`).join(' '); return <div className="chart"><span>Position over time</span><svg viewBox="0 0 300 120" preserveAspectRatio="none"><line x1="0" y1="60" x2="300" y2="60"/><path d={path}/></svg></div> }

function Scoreboard({ title, evaluation, note }: { title: string; evaluation: EvalResult; note: string }) {
  return <div className="scoreboard" data-testid={`scoreboard-${title.toLowerCase().replace(/\s+/g, '-')}`}><em>{title}</em><div><b>{evaluation.contacts}<small>/{evaluation.episodes}</small></b><span>Paddle contacts</span></div><div><b>{evaluation.legal_returns}<small>/{evaluation.episodes}</small></b><span>Legal returns</span></div><p>{note}</p></div>
}

function RLLesson({ stage, advance }: { stage:number; advance:(n:number)=>void }) {
  const [current,setCurrent]=useState(Math.min(stage,4)); const [goal,setGoal]=useState(''); const [sorted,setSorted]=useState<Record<string,string>>({}); const [sortMessage,setSortMessage]=useState('')
  const [saved,setSaved]=usePersistent<{preset:'contact'|'return'; studentEval:EvalResult|null; referenceEval:EvalResult|null}>('bracket-rl',{preset:'return',studentEval:null,referenceEval:null})
  const { preset, studentEval, referenceEval } = saved
  const [job,setJob]=useState<Job|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  const jobActive = !!job && ['queued','running'].includes(job.state)
  // A reloaded page picks the newest server job back up, so a running experiment is never orphaned.
  useEffect(()=>{ api<Job[]>('/api/jobs').then(list=>{ const active=list.find(j=>['queued','running'].includes(j.state)); if(active){ setJob(active); setCurrent(3) } }).catch(()=>{}) },[])
  useEffect(()=>{ if(!jobActive) return; const timer=setInterval(async()=>{ try { const next=await api<Job>(`/api/jobs/${job!.id}`); setJob(next); if(next.state==='completed'){ setSaved(s=>({...s,studentEval:next.result!.evaluation})); advance(4); setCurrent(4) } } catch(e){ setError((e as Error).message) } },800); return()=>clearInterval(timer) },[job?.id,jobActive,advance,setSaved]) // eslint-disable-line react-hooks/exhaustive-deps
  const train=async()=>{setError('');try{const j=await post<Job>('/api/jobs',{kind:'rl',preset,steps:10240});setJob(j);advance(3)}catch(e){setError((e as Error).message)}}
  const cancel=async()=>{ try { setJob(await post<Job>(`/api/jobs/${job!.id}/cancel`,{})) } catch(e){ setError((e as Error).message) } }
  const evaluate=async()=>{setBusy(true);setError('');try{const r=await post<EvalResult>('/api/rl/evaluate',{preset,checkpoint:'reference',episodes:20});setSaved(s=>({...s,referenceEval:r}));advance(4)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const copy=[['Set the task.','What should count as success? The robot must do more than touch the ball.'],['Choose senses and actions.','Observations are what the robot receives. Actions are what it can change.'],['Design rewards.','A reward is a score used during practice. Compare what each choice encourages.'],['Train.','Continue a real PPO model for 10,240 steps. Results can improve, stay flat, or get worse.'],['Evaluate.','Test on 20 paired, unseen shots. Legal returns tell us more than training reward alone. Compare your short practice run with a policy that practiced for 400,000 steps.']][current]
  return <LessonLayout rail={<StageRail names={['Set the task','Senses and actions','Rewards','Train','Evaluate']} current={current} set={setCurrent}/>}>
    <section className="work-panel"><Suspense fallback={<SceneFallback/>}><RobotScene mode="rl" active={job?.state==='running'}/></Suspense><div className="scene-label"><span>MuJoCo return task</span><b>{job?.state==='running'?`Training, ${Math.round(job.progress*100)}%`:'Fixed base, 6 arm actions'}</b></div></section>
    <aside className="control-panel"><p className="step">Step {current+1} of 5</p><h1>{copy[0]}</h1><p>{copy[1]}</p>
      {current===0&&<div className="choice-stack">{[['touch','Touch the ball'],['return','Land on the far side'],['rally','Win an entire match']].map(([id,label])=><button className={goal===id?'selected':''} onClick={()=>{setGoal(id);if(id==='return'){advance(1);setCurrent(1)}}} key={id}><span>{id==='return'?'✓':'○'}</span>{label}</button>)}{goal&&goal!=='return'&&<p className="micro">{goal==='touch'?'Touching is a start, but a touch that flies off the table loses the point.':'A whole match is the dream, but this lesson trains one skill at a time.'}</p>}</div>}
      {current===1&&<><p className="micro">Click each card to cycle: sense, action, neither.</p><div className="card-sort">{['Ball position','Ball speed','Arm angles','Move arm joints','Change the weather','Know the future'].map(item=><button key={item} className={sorted[item]?'selected':''} onClick={()=>setSorted(s=>({...s,[item]:!s[item]?'SENSE':s[item]==='SENSE'?'ACTION':''}))}>{item}<small>{sorted[item]==='SENSE'?'Sense':sorted[item]==='ACTION'?'Action':'Neither'}</small></button>)}</div><button className="primary" onClick={()=>{const correct=sorted['Ball position']==='SENSE'&&sorted['Ball speed']==='SENSE'&&sorted['Arm angles']==='SENSE'&&sorted['Move arm joints']==='ACTION'&&!sorted['Change the weather']&&!sorted['Know the future'];setSortMessage(correct?'Exactly. Observations come in; actions go out.':'Try again: what information comes in, and what movement goes out?');if(correct)advance(2)}}>Check my sort</button>{sortMessage&&<p className={sortMessage.startsWith('Exactly')?'result-callout':'error'}>{sortMessage}</p>}{sortMessage.startsWith('Exactly')&&<button className="secondary" onClick={()=>setCurrent(2)}>Next: design rewards</button>}</>}
      {current===2&&<div className="reward-compare"><button className={preset==='contact'?'selected':''} onClick={()=>setSaved(s=>({...s,preset:'contact'}))}><b>Contact coach</b><span>+8 per touch, +2 per legal return</span></button><button className={preset==='return'?'selected':''} onClick={()=>setSaved(s=>({...s,preset:'return'}))}><b>Return coach</b><span>+2 per touch, +10 per legal return</span></button><p>{preset==='contact'?'This coach strongly celebrates any paddle contact.':'This coach gives the biggest reward only when the ball lands legally.'}</p><button className="primary" onClick={()=>{advance(3);setCurrent(3)}}>Use this reward</button></div>}
      {current===3&&<div className="training"><div className="training-readout"><span>Training progress, {preset==='contact'?'contact':'return'} coach</span><b data-testid="training-steps">{job?`${job.trained_steps.toLocaleString()} / ${job.requested_steps.toLocaleString()}`:'Ready'}</b><div><i style={{width:`${(job?.progress||0)*100}%`}}/></div></div><button className="primary" disabled={jobActive} onClick={train}>{jobActive?'Practicing…':job?.state==='completed'?'Train again':'Continue training'}</button>{jobActive&&<button className="secondary" onClick={cancel}>Stop training</button>}{job?.state==='cancelled'&&<p className="micro">Training stopped early. Nothing was saved; start again whenever you are ready.</p>}{job?.state==='failed'&&<p className="error">{job.error}</p>}{job?.state==='completed'&&<button className="secondary" onClick={()=>setCurrent(4)}>See the results</button>}</div>}
      {current===4&&<div className="evaluate">{studentEval&&<Scoreboard title="Your model" evaluation={studentEval} note="Your policy after one short practice session. Contacts without legal returns are common this early."/>}{!studentEval&&<div className="tip"><b>No student result yet</b><p>Run the training step to get a score for your own model, or compare against the reference policy below.</p></div>}<button className="primary" onClick={evaluate} disabled={busy}>{busy?'Testing 20 shots…':'Test reference policy'}</button>{referenceEval&&<Scoreboard title="Reference model" evaluation={referenceEval} note="Reward guided practice. Evaluation checks the real goal on separate shots."/>}
        {(studentEval||referenceEval)&&<ConceptCheck done={stage>=5} onPass={()=>advance(5)} question="Why do we test the robot on shots it never practiced on?" options={['To make the reward number bigger','To check it learned the skill instead of memorizing practice shots','Because practice shots are deleted after training']} answer={1}/>}</div>}
      {error&&<p className="error">{error}</p>}
    </aside>
  </LessonLayout>
}

const baseSamples = [
  ['red',[220,55,48]],['red',[174,44,38]],['red',[245,92,70]],['red',[197,65,62]],['red',[230,78,65]],['red',[156,38,42]],
  ['blue',[47,105,210]],['blue',[39,78,178]],['blue',[71,132,225]],['blue',[52,94,188]],['blue',[88,143,221]],['blue',[31,67,153]],
  ['yellow',[235,190,48]],['yellow',[215,166,42]],['yellow',[247,211,75]],['yellow',[200,151,35]],['yellow',[225,181,55]],['yellow',[244,199,62]],
] as [string,number[]][]
const testSamples = [[196,70,63],[239,111,89],[143,52,49],[60,113,198],[80,139,218],[38,75,150],[224,184,65],[194,153,52],[246,214,101],[180,86,73],[81,118,174],[205,171,77]]
const extraSamples = [{label:'red',rgb:[130,54,50]},{label:'red',rgb:[248,135,112]},{label:'blue',rgb:[55,80,128]},{label:'blue',rgb:[110,154,205]},{label:'yellow',rgb:[163,131,48]},{label:'yellow',rgb:[250,225,131]}]

function VisionLesson({stage,advance}:{stage:number;advance:(n:number)=>void}) {
  const [current,setCurrent]=useState(Math.min(stage,4))
  const [saved,setSaved]=usePersistent<{labels:string[]; model:VisionModel|null; metrics:{training_accuracy:number;examples:number}|null; improved:boolean}>('bracket-vision',{labels:baseSamples.map(()=>''),model:null,metrics:null,improved:false})
  const { labels, model, metrics, improved } = saved
  const [predictions,setPredictions]=useState<Prediction[]>([]); const [own,setOwn]=useState('#d94c46'); const [ownResult,setOwnResult]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  const samples=useMemo(()=>baseSamples.map((s,i)=>({rgb:s[1],label:labels[i]})).filter(s=>s.label),[labels])
  const train=async(extra=false)=>{setError('');setBusy(true);const dataSamples=extra?[...samples,...extraSamples]:[...samples];try{const data=await post<{model:VisionModel;metrics:{training_accuracy:number;examples:number}}>('/api/vision/train',{samples:dataSamples});setSaved(s=>({...s,model:data.model,metrics:data.metrics,improved:extra||s.improved}));setPredictions([]);advance(extra?4:2);if(!extra)setCurrent(2)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const test=async()=>{if(!model)return;setBusy(true);setError('');try{const ps=await Promise.all(testSamples.map(rgb=>post<Prediction>('/api/vision/predict',{rgb,...model})));setPredictions(ps);advance(3)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const tryOwn=async()=>{if(!model)return;setError('');try{const rgb=[0,1,2].map(i=>parseInt(own.slice(1+i*2,3+i*2),16));const r=await post<Prediction>('/api/vision/predict',{rgb,...model});setOwnResult(`${r.label}, ${Math.round(r.scores[r.label]*100)}% sure`)}catch(e){setError((e as Error).message)}}
  const copy=[['Label examples.','Give each example the right name. The model sees RGB numbers, not the word “red.”'],['Train.','Fit a small three-class model to the examples you labeled.'],['Test.','Reveal predictions on images the model did not train on.'],['Improve.','Add examples with dimmer light and pale colors, then retrain the same model.'],['Try your own.','Choose any color and see the model’s prediction. Scores show uncertainty, not a guarantee.']][current]
  const needsModel = current >= 2 && !model
  return <LessonLayout rail={<StageRail names={['Label','Train','Test','Improve','Try your own']} current={current} set={setCurrent}/>}>
    <section className="vision-work"><div className="vision-header"><span>Data table, {baseSamples.length} examples</span><b>{labels.filter(Boolean).length} labeled</b></div><div className="sample-grid">{baseSamples.map(([,rgb],i)=><label className="sample" key={i}><i style={{background:`rgb(${rgb.join(',')})`}}/><select aria-label={`Label sample ${i+1}`} value={labels[i]} onChange={e=>{const next=[...labels];next[i]=e.target.value;setSaved(s=>({...s,labels:next}));if(next.every(Boolean)){advance(1);setCurrent(1)}}}><option value="">?</option><option>red</option><option>blue</option><option>yellow</option></select></label>)}</div>
      {predictions.length>0&&<><div className="vision-header"><span>Test table, {testSamples.length} unseen colors</span><b>Model predictions</b></div><div className="sample-grid" data-testid="test-grid">{testSamples.map((rgb,i)=><div className="sample" key={i}><i style={{background:`rgb(${rgb.join(',')})`}}/><span>{predictions[i].label}</span></div>)}</div></>}
      <div className="legend"><span><i className="red"/>Red</span><span><i className="blue"/>Blue</span><span><i className="yellow"/>Yellow</span></div></section>
    <aside className="control-panel"><p className="step">Step {current+1} of 5</p><h1>{copy[0]}</h1><p>{copy[1]}</p>
      {needsModel&&<div className="tip"><b>No trained model loaded</b><p>Your labels are saved, but the model has not been trained in this browser yet.</p><button className="secondary" onClick={()=>setCurrent(1)}>Go to train</button></div>}
      {current===0&&<div className="tip"><b>Your job</b><p>Use each dropdown to name the color. The computer only learns from the labels you give it.</p></div>}
      {current===1&&<><button className="primary" onClick={()=>train(false)} disabled={busy||samples.length<6}>{busy?'Training…':'Train classifier'}</button><p className="micro">Need at least two examples of each color.</p></>}
      {current===2&&<><button className="primary" onClick={test} disabled={!model||busy}>{busy?'Testing…':'Reveal 12 tests'}</button>{predictions.length>0&&<p className="result-callout">The model made predictions on {predictions.length} new color samples. Look at the test table: do any surprise you?</p>}{predictions.length>0&&<button className="secondary" onClick={()=>setCurrent(3)}>Next: improve</button>}</>}
      {current===3&&<><div className="tip"><b>New conditions</b><p>Six examples add shadows, pale colors, and different brightness.</p></div><button className="primary" onClick={()=>train(true)} disabled={!model||busy}>{busy?'Training…':'Add 6 + retrain'}</button>{improved&&<><p className="result-callout">Improved set trained with {metrics?.examples} examples. Same model, more varied data.</p><button className="secondary" onClick={()=>setCurrent(4)}>Next: try your own</button></>}</>}
      {current===4&&<div className="own-color"><input type="color" value={own} onChange={e=>setOwn(e.target.value)} aria-label="Choose a color"/><button className="primary" onClick={tryOwn} disabled={!model}>Ask the model</button>{ownResult&&<div className="big-prediction" data-testid="own-prediction">{ownResult}</div>}
        {(ownResult||stage>=5)&&<ConceptCheck done={stage>=5} onPass={()=>advance(5)} question="The model called a pale pink “yellow”. What is the best way to fix it?" options={['Rename the yellow label to pink','Add more labeled examples like it and retrain','Ask the model the same question again']} answer={1}/>}</div>}
      {metrics&&<div className="metrics"><div><b>{Math.round(metrics.training_accuracy*100)}%</b><span>training fit</span></div><div><b>{metrics.examples}</b><span>examples</span></div></div>}{error&&<p className="error">{error}</p>}
    </aside>
  </LessonLayout>
}

function LessonLayout({rail,children}:{rail:React.ReactNode;children:React.ReactNode}) { return <><div className="lesson-body"><div className="rail-wrap">{rail}</div><div className="lesson-content">{children}</div></div><footer className="lab-footer"><span>Simulation mode</span><span>Experiments stay on this computer</span></footer></> }
