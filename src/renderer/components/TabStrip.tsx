import { useCallback } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TAB_STRIP_HEIGHT } from '@shared/constants'
import type { TabMeta } from '@shared/ipc'
import { useChrome } from '../store'
import { Close, Globe, Moon as MoonIcon, Plus, Snowflake, Volume, VolumeMuted } from './Icons'
import { WindowControls } from './WindowControls'

function Tab({ tab }: { tab: TabMeta }): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })

  // Reordering is the only thing dnd-kit drives; every other transform is
  // ours, so the two never fight over the same property.
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  const select = useCallback(() => {
    if (!tab.isActive) void window.omega.invoke('tab:switch', tab.id)
  }, [tab.id, tab.isActive])

  const close = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      void window.omega.invoke('tab:close', tab.id)
    },
    [tab.id],
  )

  const onAuxClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault()
        void window.omega.invoke('tab:close', tab.id)
      }
    },
    [tab.id],
  )

  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      void window.omega.invoke('tab:menu', tab.id, { x: event.clientX, y: event.clientY })
    },
    [tab.id],
  )

  const dormant = tab.lifecycle === 'frozen' || tab.lifecycle === 'discarded'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'no-drag group relative flex h-[30px] min-w-[54px] max-w-[220px] flex-1 shrink-0 items-center gap-2',
        'cursor-pointer rounded-t-[9px] border border-b-0 px-2.5 transition-all duration-150',
        tab.isActive
          ? 'border-chrome-border bg-chrome-elevated text-chrome-fg shadow-[0_1px_0_0_var(--color-chrome-border)]'
          : 'border-transparent bg-white/[0.03] text-chrome-muted hover:bg-white/[0.07] hover:text-chrome-fg/85',
      ].join(' ')}
      onClick={select}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      title={tab.title || tab.url}
      {...attributes}
      {...listeners}
    >
      {/* Private tabs get a badge so the mode is always visible. */}
      {tab.incognito ? (
        <span
          className="shrink-0 rounded bg-violet-500/20 px-1 py-px text-[8.5px] font-semibold uppercase tracking-wide text-violet-300"
          title="Private tab — not saved to history"
        >
          P
        </span>
      ) : null}

      {/* Favicon slot doubles as the loading indicator. */}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {tab.isLoading ? (
          <span className="spin h-3.5 w-3.5 rounded-full border-[1.6px] border-chrome-accent border-t-transparent" />
        ) : tab.favicon ? (
          <img
            src={tab.favicon}
            alt=""
            width={15}
            height={15}
            className="h-[15px] w-[15px] rounded-[3px] object-contain"
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <Globe className="h-[15px] w-[15px] text-chrome-dim" />
        )}
      </span>

      <span className="min-w-0 flex-1 truncate text-[12px] leading-none">
        {tab.title || (tab.url.startsWith('omega://') ? 'New Tab' : tab.url) || 'New Tab'}
      </span>

      {/* Lifecycle badges: frozen keeps the DOM, discarded has none. */}
      {tab.error ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400/80" title={tab.error} />
      ) : null}
      {dormant ? (
        <span
          className="shrink-0 text-chrome-dim"
          title={tab.lifecycle === 'frozen' ? 'Frozen — timers stopped' : 'Discarded — reloads on switch'}
        >
          {tab.lifecycle === 'frozen' ? <Snowflake className="h-3 w-3" /> : <MoonIcon className="h-3 w-3" />}
        </span>
      ) : null}

      {tab.isMuted ? (
        <VolumeMuted className="h-3.5 w-3.5 shrink-0 text-chrome-dim" />
      ) : tab.isAudible ? (
        <Volume className="h-3.5 w-3.5 shrink-0 text-chrome-accent" />
      ) : null}

      <button
        type="button"
        aria-label="Close tab"
        onClick={close}
        className={[
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-colors',
          tab.isActive
            ? 'text-chrome-muted hover:bg-white/15 hover:text-white'
            : 'text-transparent group-hover:bg-white/10 group-hover:text-chrome-muted',
        ].join(' ')}
      >
        <Close className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

export function TabStrip(): React.JSX.Element {
  const tabs = useChrome((s) => s.tabs)
  const platform = useChrome((s) => s.windowState.platform)

  // An 8px activation distance stops a plain click from registering as a
  // zero-length drag, which would swallow the click-to-switch.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const from = tabs.findIndex((t) => t.id === active.id)
      const to = tabs.findIndex((t) => t.id === over.id)
      if (from === -1 || to === -1) return
      // The main process owns tab order; the list re-renders from its reply.
      void window.omega.invoke('tab:reorder', from, to)
    },
    [tabs],
  )

  const newTab = useCallback(() => {
    void window.omega.invoke('tab:create', {})
  }, [])

  return (
    <div
      className="drag flex shrink-0 items-stretch"
      style={{ height: TAB_STRIP_HEIGHT, paddingLeft: platform === 'darwin' ? 82 : 8 }}
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          <div className="scrollbar-none flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden pr-2">
            {tabs.map((tab) => (
              <Tab key={tab.id} tab={tab} />
            ))}
            <button
              type="button"
              aria-label="New tab"
              onClick={newTab}
              className="no-drag mb-[3px] ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-chrome-muted transition-colors hover:bg-white/10 hover:text-chrome-fg"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </SortableContext>
      </DndContext>

      {/* Same row as the tabs and the new-tab button, flush to the corner. */}
      <WindowControls />
    </div>
  )
}
