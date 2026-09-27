document.addEventListener("DOMContentLoaded", () => {
  const hamburger = document.getElementById("hamburger");
  const navLinks = document.getElementById("nav-links");

  if (hamburger && navLinks) {
    const setMenuOpen = (open) => {
      hamburger.classList.toggle("active", open);
      navLinks.classList.toggle("active", open);
      hamburger.setAttribute("aria-expanded", String(open));
      hamburger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };

    hamburger.addEventListener("click", () => setMenuOpen(!navLinks.classList.contains("active")));
    navLinks.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenuOpen(false)));
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sections = document.querySelectorAll("main > section");

  if (!reduceMotion && "IntersectionObserver" in window) {
    sections.forEach((section) => section.classList.add("reveal"));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal--in");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    sections.forEach((section) => observer.observe(section));
  }

  if (!reduceMotion && typeof window.particlesJS === "function") {
    window.particlesJS("particles-js", {
      particles: {
        number: { value: 22, density: { enable: true, value_area: 900 } },
        color: { value: "#7cff6b" },
        shape: { type: "circle" },
        opacity: { value: 0.28, random: true },
        size: { value: 2, random: true },
        line_linked: { enable: true, distance: 180, color: "#43b6ff", opacity: 0.18, width: 1 },
        move: { enable: true, speed: 0.55, direction: "none", random: false, straight: false, out_mode: "out" }
      },
      interactivity: {
        detect_on: "canvas",
        events: { onhover: { enable: false }, onclick: { enable: false }, resize: true }
      },
      retina_detect: true
    });
  }
});
