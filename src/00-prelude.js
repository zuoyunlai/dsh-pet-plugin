/**
 * dsh-pet — 桌面宠物（DSH Web 客户端插件）
 *
 * 挂载点（2026-10-29 审计 P3-12：旧注释还写着早已删除的 conversation.input.overlay 桥）：
 *   shell.overlay            → 宠物本体（全窗浮动层，root 作用域）
 *   conversation.input.right → 输入框右侧的 🐾 常驻入口（宠物藏起来时的唯一召唤按钮）
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
    // P3-1：useCallback 从未使用（旧的死导入）
    const { useState, useEffect, useRef } = React
