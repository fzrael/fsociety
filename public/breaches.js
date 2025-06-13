document.addEventListener('DOMContentLoaded', function() {
    const mainContent = document.querySelector('.breaches-page');
    const loadingHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <div class="loading-text">جاري تحميل قواعد البيانات...</div>
        </div>
    `;

    // Show loading screen
    mainContent.innerHTML = loadingHTML;
    mainContent.classList.add('fade-in');

    // Hide loading and show content after 4-5 seconds
    const loadingTime = Math.random() * 1000 + 4000; // Random time between 4-5 seconds
    setTimeout(() => {
        mainContent.classList.add('fade-out');
        setTimeout(() => {
            initializeBreachesPage();
        }, 500);
    }, loadingTime);
});

function initializeBreachesPage() {
    // Add event listeners to handle image loading errors
    document.querySelectorAll('.breach-logo').forEach(img => {
        img.onerror = function() {
            this.src = '/3roshleaklogo.png';
            this.onerror = null; // Prevent infinite loop if fallback also fails
        };
    });
    
    // ... rest of your existing breaches page initialization code ...
}

// ... rest of your existing code ... 