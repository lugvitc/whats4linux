import { useEffect, useRef, useState } from "react"
import { Login, GetCustomCSS, GetCustomJS } from "../wailsjs/go/api/Api"
import { EventsOn } from "../wailsjs/runtime/runtime"
import QRCode from "qrcode"
import { ChatListScreen } from "./screens/ChatScreen"
import { LoginScreen } from "./screens/LoginScreen"
import { SettingsScreen } from "./screens/SettingsScreen"
import darkModeMoon from "./assets/svgs/dark_mode_moon.svg"
import lightModeSun from "./assets/svgs/light_mode.svg"
import { useUIStore } from "./store"
import { useAppSettingsStore } from "./store/useAppSettingsStore"

type Screen = "login" | "chats" | "settings"

function App() {
  const [screen, setScreen] = useState<Screen>("login")
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<string>("waiting")

  const { theme, toggleTheme, loaded } = useAppSettingsStore()
  const { notifications, addNotification, removeNotification } = useUIStore()

  useEffect(() => {
    useAppSettingsStore.getState().loadSettings()
  }, [])

  useEffect(() => {
    if (loaded) {
      if (theme === "dark") {
        document.documentElement.classList.add("dark")
      } else {
        document.documentElement.classList.remove("dark")
      }
    }
  }, [theme, loaded])

  useEffect(() => {
    Login()

    GetCustomCSS().then(css => {
      if (css) {
        const style = document.createElement("style")
        style.id = "custom-css"
        style.innerHTML = css
        document.head.appendChild(style)
      }
    })

    GetCustomJS().then(js => {
      if (js) {
        const script = document.createElement("script")
        script.id = "custom-js"
        script.innerHTML = js
        document.body.appendChild(script)
      }
    })
  }, [])

  useEffect(() => {
    const unsubQR = EventsOn("wa:qr", async (qr: string) => {
      if (!canvasRef.current) return
      await QRCode.toCanvas(canvasRef.current, qr, {
        width: 300,
        color: { dark: "#000000", light: "#ffffff" },
      })
    })

    const unsubStatus = EventsOn("wa:status", (status: string) => {
      setStatus(status)
      if (status === "logged_in" || status === "success") {
        setScreen("chats")
      }
    })

    const unsubDownload = EventsOn("download:complete", (fileName: string) => {
      const notificationId = addNotification(`Downloaded: ${fileName}`)
      setTimeout(() => {
        removeNotification(notificationId)
      }, 3000)
    })

    return () => {
      unsubQR()
      unsubStatus()
      unsubDownload()
    }
  }, [addNotification, removeNotification])

  return (
    <div className="min-h-screen bg-light-secondary text-light-text dark:bg-black dark:text-white relative">
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {notifications.map(n => (
          <div key={n.id} className="bg-zinc-800 text-white px-4 py-2 rounded shadow-lg">
            {n.message}
          </div>
        ))}
      </div>
      <button
        onClick={toggleTheme}
        className={`absolute top-4 right-4 p-2 rounded-full z-50 ${
          theme === "dark" ? "bg-dark-tertiary hover:bg-[#2a2a2a]" : "bg-gray-200 hover:bg-gray-300"
        }`}
      >
        {theme === "light" ? (
          <img src={darkModeMoon} width={20} height={20} alt="Dark mode" />
        ) : (
          <img src={lightModeSun} width={20} height={20} alt="Light mode" />
        )}
      </button>
      {screen === "login" && <LoginScreen canvasRef={canvasRef} status={status} />}

      {(screen === "chats" || screen === "settings") && (
        <div className={screen === "settings" ? "hidden" : "contents"}>
          <ChatListScreen onOpenSettings={() => setScreen("settings")} />
        </div>
      )}

      {screen === "settings" && <SettingsScreen onBack={() => setScreen("chats")} />}
    </div>
  )
}

export default App
