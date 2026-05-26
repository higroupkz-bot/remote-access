import { useState } from 'react'
import HomePage from './pages/HomePage'
import HostPage from './pages/HostPage'
import ViewerPage from './pages/ViewerPage'

export type Page =
  | { name: 'home' }
  | { name: 'host'; signalingUrl: string }
  | { name: 'viewer'; code: string; signalingUrl: string }

export default function App() {
  const [page, setPage] = useState<Page>({ name: 'home' })

  const navigate = (p: Page) => setPage(p)

  if (page.name === 'host') {
    return <HostPage signalingUrl={page.signalingUrl} onExit={() => navigate({ name: 'home' })} />
  }
  if (page.name === 'viewer') {
    return (
      <ViewerPage
        code={page.code}
        signalingUrl={page.signalingUrl}
        onExit={() => navigate({ name: 'home' })}
      />
    )
  }
  return <HomePage onNavigate={navigate} />
}
