const txt = '???? 08:15 ???? 08:30'; const times = [...txt.matchAll(/(\d{1,2})[:.hH](\d{2})/g)]; console.log(times.length); console.log(times.map(t => t[0]));
