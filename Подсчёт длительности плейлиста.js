function getTotalMinutes(time) {
    const timeParts = time.split(":").map(Number).reverse();
    let totalMinutes = timeParts[0]/60 + timeParts[1]+ (timeParts[2]||0) *60
  return totalMinutes;
}

var list = document.querySelectorAll("ytd-playlist-panel-renderer")[1].querySelectorAll("#text.style-scope.ytd-thumbnail-overlay-time-status-renderer")
var sum = 0
for (let i =0; i < list.length; i++){
    list[i] = list[i].textContent
    let t = getTotalMinutes(list[i].textContent) 
    sum += t
}

(sum / 60)/3.5