interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>
}
