/**
 * dsh-pet — 桌面宠物（DSH Web 客户端插件）
 *
 * 挂载点：
 *   shell.overlay              → 宠物本体（全窗浮动层，root 作用域）
 *   conversation.input.overlay → 隐形桥接（session 作用域，拿到 inputActions 才能替用户发消息）
 *
 * 约束（官方红线，别改坏）：
 *   - 不 iframe、不往 document.body 追加、不 require 任何 @deepseek-ai/dsh-client-* 包
 *   - 组件抛错会让整个 slot 条目白屏，所以所有外部访问都要 try/catch
 *   - 所有资源（定时器、语音、监听）在 apply 里用 ctx.effect 注册并在返回函数里释放
 */
window.__ModuleLoader__.load({
  id: 'dsh-pet-plugin',
  factory(require) {
    'use strict'
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React
