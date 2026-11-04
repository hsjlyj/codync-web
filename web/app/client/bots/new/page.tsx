import { NewBotForm } from '@/src/client/views/bots/NewBotForm'

export const metadata = { title: '新建 Bot · Codync' }

export default function NewBotPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center p-6">
      <NewBotForm />
    </main>
  )
}
