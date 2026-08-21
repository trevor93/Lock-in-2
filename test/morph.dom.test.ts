import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Book 7: morph is an ES module (app/core/morph.js) bundled into the client. Run
// its real source here by evaluating the module body as a script — the trailing
// `export { morphInto }` is replaced with an explicit hand-off so the function
// under test is the one that actually ships.
const morphSource = readFileSync(
  resolve(__dirname, '../public/static/app/core/morph.js'), 'utf8',
).replace(/export\s*\{\s*morphInto\s*\}/, 'globalThis.morphInto = morphInto')
// eslint-disable-next-line no-new-func
new Function(morphSource)()
const morphInto: (el: Element, html: string) => void = (globalThis as any).morphInto

function root(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>'
  return document.getElementById('app')!
}

describe('morph.js — Book 6 rendering', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('exports a usable morphInto', () => {
    expect(typeof morphInto).toBe('function')
  })

  it('updates text without recreating the parent element', () => {
    const app = root()
    app.innerHTML = '<section id="s"><p id="p">old</p></section>'
    const section = document.getElementById('s')!
    const p = document.getElementById('p')!
    morphInto(app, '<section id="s"><p id="p">new</p></section>')
    // Same node identity retained; only text changed.
    expect(document.getElementById('s')).toBe(section)
    expect(document.getElementById('p')).toBe(p)
    expect(p.textContent).toBe('new')
  })

  it('preserves focus on a button across a re-render', () => {
    const app = root()
    app.innerHTML = '<button id="b">Go</button><span id="x">a</span>'
    const btn = document.getElementById('b') as HTMLButtonElement
    btn.focus()
    expect(document.activeElement).toBe(btn)
    morphInto(app, '<button id="b">Go</button><span id="x">b</span>')
    expect(document.activeElement, 'focus was lost on morph').toBe(btn)
    expect(document.getElementById('x')!.textContent).toBe('b')
  })

  it('never destroys half-typed text in the focused textarea', () => {
    const app = root()
    app.innerHTML = '<textarea id="debrief"></textarea><div id="d">0</div>'
    const ta = document.getElementById('debrief') as HTMLTextAreaElement
    ta.focus()
    ta.value = 'half a sentence the user is still writing'
    try { ta.setSelectionRange(6, 6) } catch (_) {}
    // A background refresh re-renders with an empty textarea in the template.
    morphInto(app, '<textarea id="debrief"></textarea><div id="d">1</div>')
    expect(ta.value, 'in-progress text was wiped').toBe('half a sentence the user is still writing')
    expect(document.activeElement).toBe(ta)
    expect(document.getElementById('d')!.textContent).toBe('1')
  })

  it('restores caret position in the focused text input', () => {
    const app = root()
    app.innerHTML = '<input id="q" type="text">'
    const input = document.getElementById('q') as HTMLInputElement
    input.focus()
    input.value = 'commander'
    try { input.setSelectionRange(3, 3) } catch (_) {}
    morphInto(app, '<input id="q" type="text"><span>extra</span>')
    expect(document.activeElement).toBe(input)
    // happy-dom supports selectionStart on text inputs.
    expect(input.selectionStart).toBe(3)
  })

  it('reuses keyed nodes when a list reorders', () => {
    const app = root()
    app.innerHTML =
      '<ul id="l"><li id="a">A</li><li id="b">B</li><li id="c">C</li></ul>'
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    const c = document.getElementById('c')!
    morphInto(app,
      '<ul id="l"><li id="c">C</li><li id="a">A</li><li id="b">B</li></ul>')
    // Same node objects, new order — not rebuilt.
    expect(document.getElementById('a')).toBe(a)
    expect(document.getElementById('b')).toBe(b)
    expect(document.getElementById('c')).toBe(c)
    const order = Array.from(document.querySelectorAll('#l li')).map((n) => n.id)
    expect(order).toEqual(['c', 'a', 'b'])
  })

  it('adds, changes and removes attributes in place', () => {
    const app = root()
    app.innerHTML = '<div id="card" class="old" data-drop="1">x</div>'
    const card = document.getElementById('card')!
    morphInto(app, '<div id="card" class="new" role="button">x</div>')
    expect(document.getElementById('card')).toBe(card)
    expect(card.getAttribute('class')).toBe('new')
    expect(card.getAttribute('role')).toBe('button')
    expect(card.hasAttribute('data-drop')).toBe(false)
  })

  it('removes nodes that disappear from the template', () => {
    const app = root()
    app.innerHTML = '<p id="keep">k</p><p id="gone">g</p>'
    morphInto(app, '<p id="keep">k</p>')
    expect(document.getElementById('gone')).toBeNull()
    expect(document.getElementById('keep')).not.toBeNull()
  })

  it('appends brand-new nodes from the template', () => {
    const app = root()
    app.innerHTML = '<p id="one">1</p>'
    morphInto(app, '<p id="one">1</p><p id="two">2</p>')
    expect(document.getElementById('two')!.textContent).toBe('2')
  })

  it('adopts a new value for a non-focused input', () => {
    const app = root()
    app.innerHTML = '<input id="grace" type="text" value="30">'
    const input = document.getElementById('grace') as HTMLInputElement
    // not focused
    morphInto(app, '<input id="grace" type="text" value="45">')
    expect(input.value).toBe('45')
  })
})
