function addToWatchReversePlaylist(list = null, n= -1 ) {
	if (!list){
		list = document.querySelectorAll("div#contents ytd-menu-renderer #button yt-icon")
		n = list.length-1
	}
    if (n>-1) {
        let target = list[n]
        target.scrollIntoView()
        target.click()
        setTimeout(
            () => {
                document.querySelector("ytd-menu-service-item-renderer").click()
                setTimeout(() => { addToWatchReversePlaylist(list, n-1) }, 200)
            }, 100)
    }
}

addToWatchReversePlaylist()
