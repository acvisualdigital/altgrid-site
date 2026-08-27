const menuToggle = document.querySelector('.menu-toggle')
const siteNav = document.querySelector('#site-nav')
const year = document.querySelector('#year')

menuToggle?.addEventListener('click', () => {
  const isOpen = siteNav?.classList.toggle('is-open') ?? false
  menuToggle.setAttribute('aria-expanded', String(isOpen))
})

document.querySelectorAll('.site-nav a').forEach((link) => {
  link.addEventListener('click', () => {
    siteNav?.classList.remove('is-open')
    menuToggle?.setAttribute('aria-expanded', 'false')
  })
})

if (year) year.textContent = String(new Date().getFullYear())
