// config.js
window.SITE_CONFIG = {
  repoOwner: "IsThatToasted",
  repoName: "fragtrack",

  // Labels used to categorize issues into the two lists
  inventoryLabel: "list:inventory",
  shoppingLabel: "list:shopping",

  // Status labels you want in the filter bar (you can add more)
  statusLabels: ["In Stock", "In Transit", "Looking For", "Sold", "On Hold"],

  // GitHub API: if unauthenticated, rate limit is low.
  // You can optionally paste a token in the UI (stored in localStorage).
};