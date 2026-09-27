function setStatus(message) {
  const statusText = document.getElementById("status-text");
  if (statusText) {
    statusText.textContent = message;
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const temp = document.createElement("textarea");
  temp.value = value;
  document.body.appendChild(temp);
  temp.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(temp);
  return copied;
}

document.addEventListener("DOMContentLoaded", () => {
  const hamburger = document.getElementById("hamburger");
  const navLinks = document.getElementById("nav-links");

  if (hamburger && navLinks) {
    const closeMenu = () => {
      hamburger.classList.remove("active");
      navLinks.classList.remove("active");
      hamburger.setAttribute("aria-expanded", "false");
      hamburger.setAttribute("aria-label", "Open menu");
    };

    hamburger.addEventListener("click", () => {
      const open = navLinks.classList.toggle("active");
      hamburger.classList.toggle("active", open);
      hamburger.setAttribute("aria-expanded", String(open));
      hamburger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    navLinks.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
  }

  if (window.particlesJS) {
    window.particlesJS("particles-js", {
      particles: {
        number: { value: 24, density: { enable: true, value_area: 900 } },
        color: { value: "#7cff6b" },
        shape: { type: "circle" },
        opacity: { value: 0.35, random: true },
        size: { value: 2, random: true },
        line_linked: { enable: true, distance: 170, color: "#43b6ff", opacity: 0.22, width: 1 },
        move: { enable: true, speed: 0.8, direction: "none", random: false, straight: false, out_mode: "out" }
      },
      interactivity: {
        detect_on: "canvas",
        events: { onhover: { enable: false }, onclick: { enable: false }, resize: true }
      },
      retina_detect: true
    });
  }

  const address = document.getElementById("donation-address")?.textContent?.trim();
  const copyButton = document.getElementById("copy-address");

  if (copyButton && address) {
    copyButton.addEventListener("click", async () => {
      try {
        await copyText(address);
        setStatus("Wallet address copied.");
      } catch (error) {
        setStatus("Copy failed. Use the address shown on the page.");
      }
    });
  }

});
