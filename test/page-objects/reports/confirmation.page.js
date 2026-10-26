class ConfirmationPage {
  constructor(page) {
    this.page = page
  }

  goToReports() {
    return this.page.getByRole('button', {
      name: 'Go to reports',
      exact: true
    })
  }

  returnToHome() {
    return this.page.getByRole('link', { name: 'Return to home', exact: true })
  }

  viewDraftReport() {
    return this.page.getByRole('button', {
      name: 'View draft report (opens in new tab)',
      exact: true
    })
  }
}

export { ConfirmationPage }
