import React, { useEffect, useMemo, useState } from 'react'
import Spline from '@splinetool/react-spline'
import { Plus, ChevronDown, Shield, Globe, Lock, Menu, X, Image as ImageIcon, Link as LinkIcon, Text as TextIcon, Share2 } from 'lucide-react'

// Firebase
import { initializeApp, getApps } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth'
import { getFirestore, collection, addDoc, onSnapshot, query, where, orderBy, serverTimestamp } from 'firebase/firestore'

// Helpers
const cls = (...c) => c.filter(Boolean).join(' ')

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch {
      return initialValue
    }
  })
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(value)) } catch {}
  }, [key, value])
  return [value, setValue]
}

function parseFirebaseConfig(input) {
  if (!input) return null
  try {
    const obj = typeof input === 'string' ? JSON.parse(input) : input
    const required = ['apiKey', 'authDomain', 'projectId']
    for (const k of required) if (!obj[k]) return null
    return obj
  } catch { return null }
}

function PrivacyBadge({ level }) {
  const map = {
    public: { icon: Globe, text: 'Public', color: 'text-green-400' },
    private: { icon: Lock, text: 'Private', color: 'text-red-400' },
  }
  const cfg = map[level] || { icon: Shield, text: 'Custom', color: 'text-indigo-400' }
  const Icon = cfg.icon
  return (
    <span className={cls('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-white/5', cfg.color)}>
      <Icon size={12} /> {cfg.text}
    </span>
  )
}

export default function Selphi() {
  // Settings state
  const [firebaseConfigRaw, setFirebaseConfigRaw] = useLocalStorage('selphi_firebase_config', '')
  const [customToken, setCustomToken] = useLocalStorage('__initial_auth_token', '')
  const [appId, setAppId] = useLocalStorage('__app_id', '')

  const firebaseConfig = useMemo(() => parseFirebaseConfig(firebaseConfigRaw), [firebaseConfigRaw])

  const [app, setApp] = useState(null)
  const [auth, setAuth] = useState(null)
  const [db, setDb] = useState(null)
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('Not connected')

  // App data
  const [pages, setPages] = useState([])
  const [activePageId, setActivePageId] = useState(null)
  const [widgets, setWidgets] = useState([])
  const [feed, setFeed] = useState([])

  // UI modals
  const [showPageModal, setShowPageModal] = useState(false)
  const [showLeftWidgetModal, setShowLeftWidgetModal] = useState(false)
  const [showRightWidgetModal, setShowRightWidgetModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false)
  const [mobileRightOpen, setMobileRightOpen] = useState(false)

  // Form state
  const [newPage, setNewPage] = useState({ name: '', privacyLevel: 'private' })
  const [newWidget, setNewWidget] = useState({ type: 'link', content: '', order: 0 })
  const [newPost, setNewPost] = useState('')

  // Initialize Firebase
  useEffect(() => {
    if (!firebaseConfig) { setStatus('Awaiting Firebase config'); return }
    try {
      const existing = getApps()
      const appInstance = existing.length ? existing[0] : initializeApp(firebaseConfig)
      const authInstance = getAuth(appInstance)
      const dbInstance = getFirestore(appInstance)
      setApp(appInstance)
      setAuth(authInstance)
      setDb(dbInstance)
      setStatus('Firebase initialized')
    } catch (e) {
      setStatus(`Init error: ${e.message}`)
    }
  }, [firebaseConfig])

  // Authenticate
  useEffect(() => {
    if (!auth) return
    let unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u)
        setStatus('Authenticated')
      } else {
        try {
          if (customToken) {
            setStatus('Signing in with custom token...')
            await signInWithCustomToken(auth, customToken)
          } else {
            setStatus('Signing in anonymously...')
            await signInAnonymously(auth)
          }
        } catch (e) {
          setStatus(`Auth error: ${e.message}`)
        }
      }
    })
    return () => unsub && unsub()
  }, [auth, customToken])

  // Firestore subscriptions
  useEffect(() => {
    if (!db || !user || !appId) return

    const basePath = `artifacts/${appId}/users/${user.uid}/selphi_data`

    // Pages
    const pagesCol = collection(db, `${basePath}/niche_pages`)
    const unsubPages = onSnapshot(pagesCol, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setPages(list)
      if (!activePageId) {
        const def = list.find(p => p.isDefault) || list[0]
        setActivePageId(def ? def.id : null)
      }
    })

    // Widgets
    const widgetsCol = collection(db, `${basePath}/widgets`)
    const unsubWidgets = onSnapshot(widgetsCol, (snap) => {
      setWidgets(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })

    // Feed
    const feedCol = collection(db, `${basePath}/feed_posts`)
    const unsubFeed = onSnapshot(query(feedCol, orderBy('timestamp', 'desc')), (snap) => {
      setFeed(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })

    return () => {
      unsubPages(); unsubWidgets(); unsubFeed()
    }
  }, [db, user, appId])

  const activePage = useMemo(() => pages.find(p => p.id === activePageId), [pages, activePageId])
  const leftWidgets = useMemo(() => widgets.filter(w => w.panelLocation === 'left' && w.pageId === activePageId).sort((a,b)=> (a.order||0)-(b.order||0)), [widgets, activePageId])
  const rightWidgets = useMemo(() => widgets.filter(w => w.panelLocation === 'right' && w.pageId === activePageId).sort((a,b)=> (a.order||0)-(b.order||0)), [widgets, activePageId])
  const pageFeed = useMemo(() => feed.filter(p => p.pageId === activePageId), [feed, activePageId])

  // Actions
  const createPage = async () => {
    if (!db || !user || !appId) return
    if (!newPage.name.trim()) return
    const basePath = `artifacts/${appId}/users/${user.uid}/selphi_data`
    await addDoc(collection(db, `${basePath}/niche_pages`), {
      userId: user.uid,
      name: newPage.name.trim(),
      privacyLevel: newPage.privacyLevel,
      isDefault: pages.length === 0,
      createdAt: serverTimestamp(),
    })
    setNewPage({ name: '', privacyLevel: 'private' })
    setShowPageModal(false)
  }

  const createWidget = async (panelLocation) => {
    if (!db || !user || !appId || !activePageId) return
    if (!newWidget.content.trim()) return
    const basePath = `artifacts/${appId}/users/${user.uid}/selphi_data`
    await addDoc(collection(db, `${basePath}/widgets`), {
      userId: user.uid,
      type: newWidget.type,
      content: newWidget.content.trim(),
      panelLocation,
      order: Number(newWidget.order) || 0,
      pageId: activePageId,
      createdAt: serverTimestamp(),
    })
    setNewWidget({ type: 'link', content: '', order: 0 })
    panelLocation === 'left' ? setShowLeftWidgetModal(false) : setShowRightWidgetModal(false)
  }

  const createPost = async () => {
    if (!db || !user || !appId || !activePageId) return
    if (!newPost.trim()) return
    const basePath = `artifacts/${appId}/users/${user.uid}/selphi_data`
    await addDoc(collection(db, `${basePath}/feed_posts`), {
      userId: user.uid,
      content: newPost.trim(),
      pageId: activePageId,
      timestamp: serverTimestamp(),
    })
    setNewPost('')
  }

  // Render helpers
  const WidgetCard = ({ w }) => {
    const iconMap = { link: LinkIcon, image: ImageIcon, text: TextIcon, social_embed: Share2 }
    const Icon = iconMap[w.type] || TextIcon
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-gray-100">
        <div className="flex items-center gap-2 mb-2 opacity-80">
          <Icon size={14} />
          <span className="uppercase tracking-wide text-[10px]">{w.type}</span>
        </div>
        {w.type === 'image' ? (
          <img src={w.content} alt="widget" className="rounded-lg w-full object-cover" />
        ) : (
          <p className="break-words text-gray-200 text-sm leading-relaxed">{w.content}</p>
        )}
      </div>
    )
  }

  const FeedCard = ({ p }) => (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="text-xs text-gray-400 mb-1">{new Date(p?.timestamp?.toDate?.() || Date.now()).toLocaleString()}</div>
      <div className="text-gray-100 whitespace-pre-wrap leading-relaxed">{p.content}</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header / Hero */}
      <header className="relative h-56 md:h-64 lg:h-72 overflow-hidden">
        <div className="absolute inset-0">
          <Spline scene="https://prod.spline.design/qQUip0dJPqrrPryE/scene.splinecode" style={{ width: '100%', height: '100%' }} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-gray-950/10 via-gray-950/40 to-gray-950/90 pointer-events-none" />
        <div className="relative z-10 h-full max-w-7xl mx-auto px-4 flex items-end pb-4">
          <div className="flex-1">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Selphi <span className="text-indigo-400">· Deeper than a Selfie</span></h1>
            <p className="text-sm text-gray-400">Real-time, multi-faceted social hub</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSettings(true)} className="px-3 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/15">Settings</button>
            <button onClick={() => setShowPageModal(true)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500">
              <Plus size={14} /> New Niche Page
            </button>
          </div>
        </div>
      </header>

      {/* Top controls */}
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
          <span className="text-xs text-gray-400">Currently viewing</span>
          <div className="relative">
            <button className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 px-3 py-1.5 rounded-lg text-sm">
              <span>{activePage?.name || 'Select a page'}</span>
              {activePage && <PrivacyBadge level={activePage.privacyLevel} />}
              <ChevronDown size={14} />
            </button>
            {/* Dropdown */}
            <div className="absolute mt-2 w-64 bg-gray-900/95 border border-white/10 rounded-xl shadow-xl backdrop-blur-sm">
              {pages.length === 0 ? (
                <div className="p-3 text-xs text-gray-400">No pages yet. Create one to get started.</div>
              ) : (
                <div className="max-h-64 overflow-auto p-1">
                  {pages.map(p => (
                    <button key={p.id} onClick={() => setActivePageId(p.id)} className={cls('w-full text-left px-3 py-2 rounded-lg hover:bg-white/5', activePageId === p.id && 'bg-white/10') }>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">{p.name}</span>
                        <PrivacyBadge level={p.privacyLevel} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <button onClick={() => setMobileLeftOpen(v => !v)} className="px-3 py-2 rounded-lg bg-white/10"><Menu size={16} /></button>
          <button onClick={() => setMobileRightOpen(v => !v)} className="px-3 py-2 rounded-lg bg-white/10"><Menu size={16} /></button>
        </div>

        <div className="text-xs text-gray-400">{status}{user && ` · ${user.uid.slice(0,6)}…`}{appId && ` · app ${appId}`}</div>
      </div>

      {/* Main layout */}
      <div className="max-w-7xl mx-auto px-4 pb-10 grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {/* Left Panel */}
        <aside className={cls('md:col-span-1 lg:col-span-2 space-y-3', mobileLeftOpen ? 'block' : 'hidden md:block')}>
          <div className="bg-gray-900/70 border border-white/10 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Left Panel</h3>
              <button onClick={() => setShowLeftWidgetModal(true)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500"><Plus size={12}/> Add Widget</button>
            </div>
            <div className="space-y-2">
              {leftWidgets.length === 0 ? (
                <div className="text-xs text-gray-500">No widgets yet.</div>
              ) : leftWidgets.map(w => <WidgetCard key={w.id} w={w} />)}
            </div>
          </div>
        </aside>

        {/* Center Feed */}
        <main className="md:col-span-2 lg:col-span-2 space-y-3">
          <div className="bg-gray-900/70 border border-white/10 rounded-xl p-3">
            <div className="flex items-center gap-2">
              <input value={newPost} onChange={e=>setNewPost(e.target.value)} placeholder={activePage ? `Post to ${activePage.name}…` : 'Create a page to start posting…'} className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={createPost} disabled={!activePageId} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">Post</button>
            </div>
          </div>
          <div className="space-y-3">
            {pageFeed.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-8 bg-gray-900/50 border border-white/10 rounded-xl">No posts yet.</div>
            ) : pageFeed.map(p => <FeedCard key={p.id} p={p} />)}
          </div>
        </main>

        {/* Right Panel */}
        <aside className={cls('md:col-span-1 lg:col-span-2 space-y-3', mobileRightOpen ? 'block' : 'hidden md:block')}>
          <div className="bg-gray-900/70 border border-white/10 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Right Panel</h3>
              <button onClick={() => setShowRightWidgetModal(true)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500"><Plus size={12}/> Add Widget</button>
            </div>
            <div className="space-y-2">
              {rightWidgets.length === 0 ? (
                <div className="text-xs text-gray-500">No widgets yet.</div>
              ) : rightWidgets.map(w => <WidgetCard key={w.id} w={w} />)}
            </div>
          </div>
        </aside>
      </div>

      {/* Create Page Modal */}
      {showPageModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Create Niche Page</h3>
              <button onClick={()=>setShowPageModal(false)} className="p-2 rounded-lg hover:bg-white/5"><X size={16}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400">Name</label>
                <input value={newPage.name} onChange={e=>setNewPage(p=>({...p, name: e.target.value}))} className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400">Privacy</label>
                <select value={newPage.privacyLevel} onChange={e=>setNewPage(p=>({...p, privacyLevel: e.target.value}))} className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="custom">Custom (share list)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={()=>setShowPageModal(false)} className="px-3 py-2 rounded-lg bg-white/10">Cancel</button>
                <button onClick={createPage} disabled={!user || !appId} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">Create</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Widget Modal (Left/Right reuse) */}
      {(showLeftWidgetModal || showRightWidgetModal) && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Add Widget ({showLeftWidgetModal ? 'Left' : 'Right'})</h3>
              <button onClick={()=>{ setShowLeftWidgetModal(false); setShowRightWidgetModal(false)}} className="p-2 rounded-lg hover:bg-white/5"><X size={16}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400">Type</label>
                <select value={newWidget.type} onChange={e=>setNewWidget(w=>({...w, type: e.target.value}))} className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                  <option value="link">Link</option>
                  <option value="image">Image URL</option>
                  <option value="text">Text</option>
                  <option value="social_embed">Social Embed</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400">Content</label>
                <textarea value={newWidget.content} onChange={e=>setNewWidget(w=>({...w, content: e.target.value}))} rows={3} className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-400">Order</label>
                <input type="number" value={newWidget.order} onChange={e=>setNewWidget(w=>({...w, order: e.target.value}))} className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={()=>{ setShowLeftWidgetModal(false); setShowRightWidgetModal(false)}} className="px-3 py-2 rounded-lg bg-white/10">Cancel</button>
                <button onClick={()=>createWidget(showLeftWidgetModal ? 'left' : 'right')} disabled={!user || !appId || !activePageId} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-gray-900 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Selphi Settings</h3>
              <button onClick={()=>setShowSettings(false)} className="p-2 rounded-lg hover:bg-white/5"><X size={16}/></button>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Firebase Web Config (JSON)</label>
                <textarea value={firebaseConfigRaw} onChange={e=>setFirebaseConfigRaw(e.target.value)} rows={8} placeholder='{"apiKey":"...","authDomain":"...","projectId":"...","appId":"..."}' className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
                <p className="text-[10px] text-gray-500">Stored locally only. Required: apiKey, authDomain, projectId</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Initial Auth Token (optional)</label>
                <input value={customToken} onChange={e=>setCustomToken(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="__initial_auth_token" />
                <label className="text-xs text-gray-400">App ID</label>
                <input value={appId} onChange={e=>setAppId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="__app_id" />
                <div className="text-xs text-gray-500">Data path: /artifacts/{appId || 'your-app'}/users/{user?.uid || 'user'}/selphi_data/*</div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={()=>setShowSettings(false)} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
