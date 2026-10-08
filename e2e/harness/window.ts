import type { LaunchedApp } from './launch'

// Resizes the real BrowserWindow's height, as a user's drag would. Returns the height it replaced.
export function setWindowHeight(app: LaunchedApp, height: number): Promise<number> {
  return app.app.evaluate(({ BrowserWindow }, next) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [width, previous] = win.getSize()
    win.setSize(width, next)
    return previous
  }, height)
}
