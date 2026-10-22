    /* ================= 样式 ================= */

    const CSS = `
.dsh-pet-layer{position:absolute;inset:0;pointer-events:none;z-index:60;
  /* 主题映射层：宿主换 token 只改这里 */
  --pet-fg:var(--dsw-alias-label-primary,#e9ecf1);
  --pet-bg:var(--dsw-alias-bg-layer-2,rgba(32,35,42,.96));
  --pet-bg-hover:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));
  --pet-border:var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  --pet-accent:var(--dsw-alias-brand-primary,#5b8def);
  --pet-btn-bg:var(--dsw-alias-button-primary-fill,#4a6cf7);
  --pet-btn-fg:var(--dsw-alias-label-primary-inverted,#fff)}
.dsh-pet-root{position:absolute;right:26px;bottom:186px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:6px;
  max-height:calc(100vh - 190px);
  font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--pet-fg);
  pointer-events:none;user-select:none;-webkit-user-select:none;touch-action:none}
.dsh-pet-toggle{pointer-events:auto;cursor:pointer;border:none;background:transparent;color:inherit;font-size:13px;line-height:1;
  padding:4px 6px;border-radius:8px;opacity:.65}
.dsh-pet-toggle{display:inline-flex;align-items:center;justify-content:center;gap:2px}
.dsh-pet-toggle svg.dsh-pet-mark{display:block;width:18px;height:18px}
.dsh-pet-badge-dot{width:5px;height:5px;border-radius:50%;background:#e0477a;box-shadow:0 0 4px rgba(224,71,122,.8)}
.dsh-pet-toggle:hover{opacity:1;background:var(--pet-bg-hover)}
.dsh-pet-root *{box-sizing:border-box}
.dsh-pet-bubble{pointer-events:auto;max-width:min(260px,58vw);padding:8px 11px;border-radius:12px;font-size:12.5px;line-height:1.5;
  white-space:pre-wrap;word-break:break-word;
  background:var(--pet-bg);border:1px solid var(--pet-border);
  box-shadow:0 6px 22px rgba(0,0,0,.28);position:relative;animation:dsh-pet-pop .18s ease-out}
.dsh-pet-bubble:after{content:"";position:absolute;right:22px;bottom:-5px;width:9px;height:9px;transform:rotate(45deg);
  background:var(--pet-bg);border-right:1px solid var(--pet-border);
  border-bottom:1px solid var(--pet-border)}
.dsh-pet-row{display:flex;align-items:flex-end;gap:6px;pointer-events:none}
.dsh-pet-input{pointer-events:auto;width:186px;font-size:12px;padding:6px 9px;border-radius:999px;outline:none;
  background:var(--pet-bg);color:inherit;
  border:1px solid var(--pet-border)}
.dsh-pet-input:focus{border-color:var(--pet-accent)}
.dsh-pet-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;margin-bottom:10px;
  background:#8a8f9a;box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.dsh-pet-dot.on{background:#3ecf8e;box-shadow:0 0 6px rgba(62,207,142,.55)}
.dsh-pet-dot.busy{background:#f5b942;animation:dsh-pet-pulse 1s ease-in-out infinite}
.dsh-pet-dot.bad{background:#e05a5a;box-shadow:0 0 6px rgba(224,90,90,.5)}
@keyframes dsh-pet-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.dsh-pet-send{pointer-events:auto;border:none;border-radius:999px;width:26px;height:26px;padding:0;cursor:pointer;font-size:13px;
  background:var(--pet-btn-bg);color:var(--pet-btn-fg);
  display:flex;align-items:center;justify-content:center;transition:opacity .15s}
.dsh-pet-send[disabled]{opacity:.45;cursor:default}
.dsh-pet-actor{pointer-events:auto;cursor:grab;width:104px;height:104px;position:relative;
  transform-origin:center center;transition:transform 1.25s cubic-bezier(.4,0,.2,1)}
.dsh-pet-actor:active{cursor:grabbing}
.dsh-pet-actor svg{width:100%;height:100%;display:block;overflow:visible}
.dsh-pet-figure{transform-origin:50% 100%;display:flex;align-items:flex-end;justify-content:center;height:100%}
.dsh-pet-figbox{position:relative;height:100%;display:flex;align-items:flex-end}
.dsh-pet-img{height:100%;width:auto;display:block;
  filter:drop-shadow(0 7px 14px rgba(0,0,0,.32));user-select:none;-webkit-user-drag:none;pointer-events:none}
.dsh-pet-imgwrap{position:relative;height:100%;display:flex;align-items:flex-end;justify-content:center;
  transform-origin:50% 100%;animation:dsh-pet-alive 5.2s ease-in-out infinite}
.dsh-pet-imgwrap .dsh-pet-img{position:absolute;bottom:0;left:50%;transform:translateX(-50%)}
/* 1.16：动作视频（VP9 + alpha）—— 真 24fps，比翻帧顺得多 */
.dsh-pet-video{height:100%;width:auto;display:block;object-fit:contain;
  filter:drop-shadow(0 7px 14px rgba(0,0,0,.32));pointer-events:none;background:transparent}
/* 1.15：换帧时带方向位移 + 轻微放大 + 1px 模糊，模仿运动模糊，硬切不明显 */
.dsh-pet-img-cur{animation:dsh-pet-img-in .18s ease-out}
.dsh-pet-img-prev{animation:dsh-pet-img-out .18s ease-out forwards}
@keyframes dsh-pet-img-in{
  from{opacity:0;filter:blur(1px) drop-shadow(0 7px 14px rgba(0,0,0,.32));
    transform:translateX(calc(-50% + var(--pet-dx,3px))) scale(.994)}
  to{opacity:1;filter:blur(0) drop-shadow(0 7px 14px rgba(0,0,0,.32));
    transform:translateX(-50%) scale(1)}
}
@keyframes dsh-pet-img-out{
  from{opacity:1;filter:blur(0) drop-shadow(0 7px 14px rgba(0,0,0,.32));
    transform:translateX(-50%) scale(1)}
  to{opacity:0;filter:blur(1px) drop-shadow(0 7px 14px rgba(0,0,0,.32));
    transform:translateX(calc(-50% + var(--pet-dx,3px))) scale(1.006)}
}
/* 常驻微动：呼吸 + 髋部左右摆，60fps 由合成器跑，CPU 零负担 */
@keyframes dsh-pet-alive{
  0%{transform:scale(1) rotate(-0.5deg)}
  25%{transform:scale(1.006) rotate(0deg)}
  50%{transform:scale(1.012) rotate(0.5deg)}
  75%{transform:scale(1.006) rotate(0deg)}
  100%{transform:scale(1) rotate(-0.5deg)}
}
@media (prefers-reduced-motion:reduce){
  .dsh-pet-imgwrap{animation:none}
  .dsh-pet-img-cur,.dsh-pet-img-prev{animation:none}
}
.dsh-pet-gear{position:absolute;right:-2px;top:-2px;pointer-events:auto;cursor:pointer;border:none;border-radius:999px;
  width:20px;height:20px;font-size:11px;line-height:1;opacity:0;transition:opacity .15s;
  background:var(--pet-bg);color:inherit;border:1px solid var(--pet-border)}
.dsh-pet-actor-wrap:hover .dsh-pet-gear{opacity:1}
/* —— 设置面板 —— */
/* 面板独立悬浮在宠物上方，不进 flex 流：否则会被压扁并在内部滚动 */
/* 设置面板：贴紧右边缘、更窄，并抬到宠物上方 —— 原先 right:24/bottom:170 会把她整个人盖住 */
.dsh-pet-panelwrap{position:fixed;right:10px;bottom:262px;z-index:80;
  pointer-events:auto;display:flex;flex-direction:column;align-items:flex-end;
  max-height:calc(100vh - 278px)}

.dsh-pet-panel{pointer-events:auto;width:196px;padding:8px 9px 9px;border-radius:11px;font-size:11px;line-height:1.32;
  background:var(--pet-bg);border:1px solid var(--pet-border);
  box-shadow:0 12px 34px rgba(0,0,0,.42);display:flex;flex-direction:column;gap:5px;
  max-height:100%;overflow-y:auto;overscroll-behavior:contain;
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.dsh-pet-panel::-webkit-scrollbar{width:6px}
.dsh-pet-panel::-webkit-scrollbar-thumb{background:var(--pet-border);border-radius:3px}
.dsh-pet-panel h4{margin:0 0 1px;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;letter-spacing:.02em}
.dsh-pet-panel .x{cursor:pointer;opacity:.55;border:none;background:none;color:inherit;font-size:14px;line-height:1;padding:0 2px}
.dsh-pet-panel .x:hover{opacity:1}
.dsh-pet-sec{font-size:9.5px;letter-spacing:.14em;opacity:.42;margin:3px 0 0;text-transform:uppercase;flex:0 0 auto}
.dsh-pet-sep{height:1px;background:var(--pet-border);opacity:.65;margin:4px 0 2px}
.dsh-pet-field{display:flex;align-items:center;gap:6px;min-height:22px;flex:0 0 auto}
.dsh-pet-field.wide{display:block}
.dsh-pet-field .lb{flex:0 0 34px;opacity:.62}
.dsh-pet-field .val{flex:0 0 auto;min-width:34px;text-align:right;font-variant-numeric:tabular-nums;opacity:.72}
.dsh-pet-panel input[type=time]{font-size:10.5px;padding:1px 3px;border-radius:5px;
  background:transparent;color:inherit;border:1px solid var(--pet-border);color-scheme:dark}
.dsh-pet-panel input[type=range]{flex:1;min-width:0;height:14px;accent-color:var(--pet-accent)}
.dsh-pet-grid2{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;margin:1px 0;flex:0 0 auto}

/* 自定义开关 */
.dsh-pet-tg{display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;min-height:19px}
.dsh-pet-tg input{display:none}
.dsh-pet-tg i{position:relative;flex:0 0 auto;width:22px;height:12px;border-radius:999px;
  background:var(--pet-border);transition:background .16s}
.dsh-pet-tg i:after{content:"";position:absolute;top:1.5px;left:1.5px;width:9px;height:9px;border-radius:50%;
  background:var(--pet-bg);transition:transform .16s}
.dsh-pet-tg input:checked + i{background:var(--pet-accent)}
.dsh-pet-tg input:checked + i:after{transform:translateX(10px)}
.dsh-pet-tg span{opacity:.78;font-size:11px}

/* 自定义下拉（不用原生 select：Windows 弹出层是白底，深色主题下看不清） */
.dsh-pet-sel{position:relative;flex:0 0 auto}
.dsh-pet-sel-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:6px;
  font:inherit;font-size:11px;color:inherit;text-align:left;cursor:pointer;
  padding:3px 7px;border-radius:6px;background:transparent;border:1px solid var(--pet-border)}
.dsh-pet-sel-btn:hover{background:var(--pet-bg-hover)}
.dsh-pet-sel-btn .v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pet-sel-btn .a{opacity:.5;font-size:9px}
.dsh-pet-sel.open .dsh-pet-sel-btn{border-color:var(--pet-accent)}
.dsh-pet-sel-list{display:flex;flex-direction:column;gap:1px;margin-top:3px;padding:2px;
  border:1px solid var(--pet-border);border-radius:7px;background:var(--pet-bg)}
.dsh-pet-sel-item{font:inherit;font-size:11px;text-align:left;color:inherit;cursor:pointer;
  padding:3px 6px;border-radius:5px;background:transparent;border:none}
.dsh-pet-sel-item:hover{background:var(--pet-bg-hover)}
.dsh-pet-sel-item.on{color:var(--pet-accent);font-weight:600}

.dsh-pet-seg{display:flex;gap:3px;flex:0 0 auto}
.dsh-pet-seg button{flex:1;font:inherit;font-size:10.5px;padding:3px 0;border-radius:5px;cursor:pointer;color:inherit;
  background:transparent;border:1px solid var(--pet-border);white-space:nowrap}
.dsh-pet-seg button:hover{background:var(--pet-bg-hover)}
.dsh-pet-seg button.on{background:var(--pet-accent);border-color:transparent;color:#fff}
.dsh-pet-seg button.danger:hover{color:#e05a5a;border-color:#e05a5a}

/* —— 动作 —— */
@keyframes dsh-pet-pop{from{transform:translateY(4px) scale(.96);opacity:0}to{transform:none;opacity:1}}
@keyframes dsh-pet-breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes dsh-pet-hop{0%,100%{transform:translateY(0)}35%{transform:translateY(-9px)}60%{transform:translateY(0)}}
@keyframes dsh-pet-dance{0%{transform:rotate(-9deg) translateY(0)}25%{transform:rotate(0) translateY(-5px)}
  50%{transform:rotate(9deg) translateY(0)}75%{transform:rotate(0) translateY(-5px)}100%{transform:rotate(-9deg) translateY(0)}}
@keyframes dsh-pet-shy{0%,100%{transform:scale(1,1)}50%{transform:scale(1.06,.94)}}
@keyframes dsh-pet-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-3px)}40%{transform:translateX(3px)}
  60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}
@keyframes dsh-pet-stroll{0%,100%{transform:translateX(0)}50%{transform:translateX(-26px)}}
@keyframes dsh-pet-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.12)}}
@keyframes dsh-pet-talk{0%,100%{transform:scaleY(.5)}50%{transform:scaleY(1.25)}}
@keyframes dsh-pet-sway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}

.dsh-pet-body{transform-origin:70px 112px;animation:dsh-pet-breathe 3.4s ease-in-out infinite}
.mood-walk .dsh-pet-body{animation:dsh-pet-stroll 3.6s ease-in-out infinite,dsh-pet-breathe 1.1s ease-in-out infinite}
.mood-dance .dsh-pet-body{animation:dsh-pet-dance .9s ease-in-out infinite}
.mood-shy .dsh-pet-body{animation:dsh-pet-shy 1.5s ease-in-out infinite}
.mood-angry .dsh-pet-body{animation:dsh-pet-shake .42s linear infinite}
.mood-happy .dsh-pet-body{animation:dsh-pet-hop .85s ease-in-out infinite}
.mood-talk .dsh-pet-body{animation:dsh-pet-breathe 2s ease-in-out infinite}
.dsh-pet-eye{transform-origin:center;animation:dsh-pet-blink 5.2s infinite}
.mood-sleep .dsh-pet-eye{animation:none}
.dsh-pet-mouth{transform-origin:center}
.mood-talk .dsh-pet-mouth{animation:dsh-pet-talk .22s ease-in-out infinite}
.dsh-pet-tail{transform-origin:96px 96px;animation:dsh-pet-sway 2.6s ease-in-out infinite}
.mood-angry .dsh-pet-tail{animation:dsh-pet-sway .5s ease-in-out infinite}
.dsh-pet-zzz{font-size:11px;opacity:.7}

/* —— 立绘的动作（幅度比 SVG 那套大，不然看不出在动） —— */
@keyframes fig-idle{0%,100%{transform:rotate(-1.1deg) translateY(0)}50%{transform:rotate(1.1deg) translateY(-1px)}}
@keyframes fig-walk{0%,100%{transform:translateX(0) rotate(0)}25%{transform:translateX(-5px) rotate(.7deg)}
  75%{transform:translateX(13px) rotate(-.9deg)}}
@keyframes fig-dance{0%{transform:rotate(-4deg) translateY(0)}25%{transform:rotate(0) translateY(-6px)}
  50%{transform:rotate(4deg) translateY(0)}75%{transform:rotate(0) translateY(-6px)}100%{transform:rotate(-7deg) translateY(0)}}
@keyframes fig-shy{0%,100%{transform:scale(1,1) rotate(0) translateY(0)}50%{transform:scale(1.01,.99) rotate(-1.4deg) translateY(-2px)}}
@keyframes fig-angry{0%,100%{transform:translateX(0) rotate(0)}25%{transform:translateX(-2px) rotate(-.8deg)}
  75%{transform:translateX(2px) rotate(.8deg)}}
@keyframes fig-talk{0%,100%{transform:translateY(0)}50%{transform:translateY(1.6px)}}
@keyframes fig-hop{0%,100%{transform:translateY(0)}35%{transform:translateY(-9px)}70%{transform:translateY(0)}}
@keyframes fig-sleep{0%,100%{transform:scale(1,1)}50%{transform:scale(1.012,.988)}}
@keyframes fig-poked{0%{transform:translateY(0) scale(1)}22%{transform:translateY(-7px) scale(1.03)}
  60%{transform:translateY(0) scale(1)}100%{transform:translateY(0) scale(1)}}
.mood-idle .dsh-pet-figure{animation:fig-idle 5.2s ease-in-out infinite}
.mood-walk .dsh-pet-figure{animation:fig-walk 3.8s ease-in-out infinite}
.mood-dance .dsh-pet-figure{animation:fig-dance .95s ease-in-out infinite}
.mood-shy .dsh-pet-figure{animation:fig-shy 1.9s ease-in-out infinite}
.mood-angry .dsh-pet-figure{animation:fig-angry .45s linear infinite}
.mood-talk .dsh-pet-figure{animation:fig-talk 1.7s ease-in-out infinite}
.mood-happy .dsh-pet-figure{animation:fig-hop 1s ease-in-out infinite}
.mood-sleep .dsh-pet-figure{animation:fig-sleep 6s ease-in-out infinite}
.mood-poked .dsh-pet-figure{animation:fig-poked .55s ease-out 2}
.mood-poked .dsh-pet-body{animation:dsh-pet-hop .6s ease-out 2}

/* —— 立绘的表情贴纸（没有五官层时唯一的“表情”） —— */
.dsh-pet-marks{position:absolute;inset:0;pointer-events:none}
.fx-mark{position:absolute;font-style:normal;line-height:1}
.fx-mark.blush{width:18px;height:10px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(255,120,150,.55),rgba(255,120,150,0) 72%);
  filter:blur(.6px);animation:mark-in .5s ease-out both}
.fx-mark.sweat{width:5px;height:7px;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;
  background:rgba(140,200,255,.85);box-shadow:0 0 3px rgba(140,200,255,.6);animation:mark-in .55s .15s ease-out both}
.fx-mark.vein{font-size:13px;animation:mark-pulse .6s ease-in-out infinite alternate}
.fx-mark.zzz{font-size:12px;opacity:.75;color:var(--pet-fg);
  animation:mark-float 2.4s ease-in-out infinite}
.fx-mark.zzz.z2{font-size:9px;animation-delay:.6s}
.fx-mark.spark{font-size:12px;animation:mark-pulse .9s ease-in-out infinite alternate}
@keyframes mark-in{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
@keyframes mark-pulse{from{opacity:.55;transform:scale(.9)}to{opacity:1;transform:scale(1.12)}}
@keyframes mark-float{0%{opacity:0;transform:translateY(0) scale(.8)}
  30%{opacity:.85}100%{opacity:0;transform:translateY(-9px) scale(1.1)}}
@media (prefers-reduced-motion:reduce){
  .dsh-pet-body,.dsh-pet-eye,.dsh-pet-mouth,.dsh-pet-tail{animation:none!important}
}

/* —— 视线跟随 —— */
.dsh-pet-pupils{transform:translate(var(--gx,0px),var(--gy,0px));transition:transform .1s linear}

/* —— 特效层 —— */
.dsh-pet-fx{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:80}
.dsh-pet-fx-ink,.dsh-pet-fx-confetti,.dsh-pet-fx-boom{position:absolute;inset:0}
.dsh-pet-fx-ink i{position:absolute;opacity:0;animation:fx-ink-in 3.6s ease-out forwards;
  filter:drop-shadow(0 3px 4px rgba(0,0,0,.28))}
.dsh-pet-fx-ink i svg{width:100%;height:100%;display:block;overflow:visible}
@keyframes fx-ink-in{
  0%{transform:scale(.35);opacity:0}
  16%{transform:scale(1.06);opacity:.92}
  28%{transform:scale(1);opacity:.9}
  78%{opacity:.82}
  100%{opacity:0}
}
.dsh-pet-fx-confetti i{position:absolute;top:0;border-radius:1px;opacity:0;
  animation-name:fx-confetti-fall;animation-timing-function:linear;animation-fill-mode:forwards}
@keyframes fx-confetti-fall{
  0%{transform:translate3d(0,-10vh,0) rotate(0);opacity:0}
  8%{opacity:1}
  100%{transform:translate3d(var(--drift,0px),110vh,0) rotate(var(--rot,360deg));opacity:.85}
}
.dsh-pet-fx-cloud{position:absolute;right:96px;top:96px;width:120px;height:108px;opacity:0;
  animation:fx-cloud-in 4s ease-out forwards}
.dsh-pet-fx-cloud svg{width:100%;height:100%;overflow:visible}
@keyframes fx-cloud-in{
  0%{transform:translate(-30px,-8px) scale(.7);opacity:0}
  18%{transform:none;opacity:1}
  78%{opacity:1}
  100%{transform:translate(18px,-14px);opacity:0}
}
.fx-bolt{animation:fx-bolt-flash 4s linear infinite}
@keyframes fx-bolt-flash{0%,40%,44%,100%{opacity:.12}42%,46%{opacity:1}}
.fx-rain{opacity:.45;animation:fx-rain-drop 1.1s linear infinite}
@keyframes fx-rain-drop{0%{transform:translateY(-6px);opacity:0}30%{opacity:.6}100%{transform:translateY(9px);opacity:0}}
.dsh-pet-fx-fog{position:absolute;inset:0;width:100%;height:100%;pointer-events:auto;cursor:crosshair;
  animation:fx-fog-fade 7s ease-in-out forwards}
@keyframes fx-fog-fade{0%{opacity:0}10%{opacity:1}82%{opacity:1}100%{opacity:0}}
.fx-bomb{position:absolute;width:26px;height:26px;opacity:0;
  animation:fx-bomb-fly 1.5s cubic-bezier(.35,0,.9,.55) forwards}
.fx-bomb svg{width:100%;height:100%;display:block;overflow:visible}
.fx-spark{animation:fx-spark-pulse .28s ease-in-out infinite alternate}
@keyframes fx-spark-pulse{from{opacity:.4;transform:scale(.8)}to{opacity:1;transform:scale(1.25)}}
@keyframes fx-bomb-fly{
  0%{transform:translate(0,0) scale(.4) rotate(0deg);opacity:0}
  10%{transform:translate(0,0) scale(1) rotate(0deg);opacity:1}
  60%{transform:translate(var(--tx,0),calc(var(--ty,0) * .45)) scale(1.05) rotate(180deg);opacity:1}
  100%{transform:translate(var(--tx,0),var(--ty,0)) scale(.5) rotate(360deg);opacity:0}
}
.fx-shake{position:absolute;inset:0;animation:fx-shake-k 2.6s ease-out forwards}
@keyframes fx-shake-k{
  0%,44%{transform:translate(0,0)}
  46%{transform:translate(-5px,3px)}
  48%{transform:translate(5px,-4px)}
  50%{transform:translate(-4px,-3px)}
  52%{transform:translate(3px,4px)}
  54%{transform:translate(-2px,1px)}
  57%,100%{transform:translate(0,0)}
}
.fx-flash{position:absolute;inset:0;background:#fff;opacity:0;animation:fx-flash 2.4s ease-out forwards}
@keyframes fx-flash{0%,44%{opacity:0}46%{opacity:.75}49%{opacity:0}100%{opacity:0}}
.fx-crack{position:absolute;inset:0;width:100%;height:100%;opacity:0;animation:fx-crack-in 2.6s ease-out forwards;
  color:var(--pet-fg);filter:drop-shadow(0 1px 0 rgba(255,255,255,.5))}
@keyframes fx-crack-in{0%,45%{opacity:0}48%{opacity:1}78%{opacity:.8}100%{opacity:0}}
.fx-impact{transform-box:fill-box;transform-origin:50% 50%;opacity:0;animation:fx-impact 2.6s ease-out forwards}
@keyframes fx-impact{
  0%,45%{opacity:0;transform:scale(.3)}
  48%{opacity:.95;transform:scale(1)}
  58%{opacity:.45;transform:scale(1.7)}
  70%,100%{opacity:0;transform:scale(2.1)}
}
@media (prefers-reduced-motion:reduce){
  .dsh-pet-fx-ink i,.dsh-pet-fx-confetti i,.dsh-pet-fx-cloud,.fx-bomb,.fx-crack,.fx-flash{animation:none!important;opacity:.9}
}
.dsh-pet-menu-mask{position:fixed;inset:0;z-index:80;pointer-events:auto}
.dsh-pet-menu{position:fixed;min-width:132px;padding:4px;border-radius:10px;background:var(--pet-bg);border:1px solid var(--pet-bd);box-shadow:0 12px 32px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:2px}
.dsh-pet-menu-item{appearance:none;border:0;background:transparent;color:var(--pet-fg);text-align:left;font:inherit;font-size:12.5px;padding:7px 10px;border-radius:7px;cursor:pointer}
.dsh-pet-menu-item:hover{background:rgba(127,127,127,.16)}
`
