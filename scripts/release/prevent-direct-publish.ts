if (!process.env.BYPASS_PREVENT_PUBLISH) {
  throw new Error(
    "Direct publishing from the repository root is disabled. Publish the staged .release/main package via the release workflow.",
  );
}
