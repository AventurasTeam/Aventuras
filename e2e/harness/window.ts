import type { LaunchedApp } from './launch'

// Resize the real BrowserWindow, as a user's drag would; each returns the size it replaced.
export function setWindowWidth(app: LaunchedApp, width: number): Promise<number> {
  return app.app.evaluate(({ BrowserWindow }, next) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [previous, height] = win.getSize()
    win.setSize(next, height)
    return previous
  }, width)
}

export function setWindowHeight(app: LaunchedApp, height: number): Promise<number> {
  return app.app.evaluate(({ BrowserWindow }, next) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [width, previous] = win.getSize()
    win.setSize(width, next)
    return previous
  }, height)
}
