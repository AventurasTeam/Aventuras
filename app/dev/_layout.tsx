import { Redirect, Stack } from 'expo-router'

// A release build ships these routes and a deep link reaches them; only a dev build serves them.
export default function DevLayout() {
  if (!__DEV__) return <Redirect href="/" />
  return <Stack screenOptions={{ headerTitle: 'Dev' }} />
}
