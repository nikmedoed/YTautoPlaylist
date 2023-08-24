function asdasdsad(n=100){
	if (n>0){
		document.querySelector("ytd-playlist-video-renderer div ytd-menu-renderer yt-icon-button button").click()
		setTimeout(
			()=>{
				document.querySelector("#items > ytd-menu-service-item-renderer:nth-child(4)").click()
				setTimeout(()=>{asdasdsad(n-1)},100)
			},100)
	}   
}