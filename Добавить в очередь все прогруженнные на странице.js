function addToWatchNow(n = 0) {
    var elements = document.querySelectorAll("div#details div#menu ytd-menu-renderer yt-icon-button.dropdown-trigger.style-scope.ytd-menu-renderer button")
    if (n < elements.length) {
        let target = elements[n]
        target.scrollIntoView()
        target.click()
        setTimeout(
            () => {
                document.querySelector("ytd-menu-service-item-renderer").click()
                setTimeout(() => { addToWatchNow(n + 1) }, 200)
            }, 100)
    }

}


addToWatchNow()