import './styles.css';

const links = document.querySelectorAll('.study-link');
links.forEach((link, index) => {
  link.style.setProperty('--delay', `${index * 55}ms`);
});
