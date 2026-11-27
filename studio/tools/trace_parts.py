# Step 2: cut the traced reference into the code body's parts, one set per view.
# usage: python3 tools/trace_parts.py <calib dir> <dir from trace_parts.js> <out json>
# Each part keeps the reference pixels it owns (plus a 3px overlap so joints can bend without gaps), traced as skin / shade / outline paths.
import sys,json,numpy as np,cv2
from scipy import ndimage as ndi
CAL,WORK,OUT=[a.rstrip('/')+'/' if i<2 else a for i,a in enumerate(sys.argv[1:4])]
VIEWS=['front','front_left_45','left_profile','back_left_45','back','back_right_45','right_profile','front_right_45']
PAL={'skin':(254,188,143),'outline':(76,40,26),'shade':(195,125,96)}
S=4
def paths(mask,min_area=4,eps=1.2):
    big=cv2.resize(mask.astype(np.float32),None,fx=S,fy=S,interpolation=cv2.INTER_CUBIC)
    big=cv2.GaussianBlur(big,(0,0),S*0.45);b=(big>0.5).astype(np.uint8)
    cs,_=cv2.findContours(b,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_NONE);d=[]
    for c in cs:
        if abs(cv2.contourArea(c))/(S*S)<min_area: continue
        a=cv2.approxPolyDP(c,eps,True)[:,0,:]/S
        if len(a)>=3: d.append('M'+' L'.join('%.1f %.1f'%(x,y) for x,y in a)+'Z')
    return ' '.join(d)
meta=json.load(open(WORK+'parts.json'));names=meta['names']
im=cv2.imread(CAL+'reference_clean.png');fb=json.load(open(CAL+'fig_boxes.json'))
res={'names':names,'views':{}}
for i,v in enumerate(VIEWS):
    x0,y0,x1,y1=fb[i];c=im[y0:y1,x0:x1].astype(np.float32)[...,::-1]
    ref=cv2.imread(CAL+'ref_mask_%d.png'%i,0)>127;h,w=ref.shape
    lab=cv2.imread(WORK+'label_%d.png'%i,0).astype(np.int32)
    mine=lab>0;best=(-1,0)
    for dx in range(-40,41,1):
        m=np.roll(mine,dx,axis=1);iou=(m&ref).sum()/max(1,(m|ref).sum())
        if iou>best[0]:best=(iou,dx)
    dx=best[1];lab=np.roll(lab,dx,axis=1)
    # pixels of the reference that no part covers belong to the nearest part
    _,(iy,ix)=ndi.distance_transform_edt(lab==0,return_indices=True)
    own=np.where(lab>0,lab,lab[iy,ix])*ref
    keys=list(PAL);cen=np.array([PAL[k] for k in keys],np.float32)
    cls=((c[:,:,None,:]-cen[None,None])**2).sum(-1).argmin(-1)
    inner=cv2.erode(ref.astype(np.uint8),np.ones((3,3),np.uint8))>0
    shp=cv2.imread(WORK+'shape_%d.png'%i)  # BGR: B=bits 16-23, G=8-15, R=0-7
    shp=np.roll(shp,dx,axis=1);parts={}
    for k,n in enumerate(names,1):
        m=own==k;area=int(m.sum())
        if area<20: parts[n]={'area':area};continue
        k0=k-1;chan=2-(k0//8);own_shape=((shp[:,:,chan]>>(k0%8))&1)>0
        md=(cv2.dilate(m.astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(11,11)))>0)&ref
        L={q:(cls==j)&md for j,q in enumerate(keys)}
        parts[n]={'area':area,'base':paths((L['skin']|L['shade']|L['outline'])&md),'skin':paths(((L['skin']|L['shade'])&md&inner)|(own_shape&ref&inner)),'shade':paths(L['shade']&md&inner),'outline':paths(L['outline'],min_area=3)}
    res['views'][v]={'w':w,'h':h,'dx':dx,'iou':round(best[0],3),'parts':parts}
    print(v,'dx',dx,'iou',round(best[0],3),{n:p['area'] for n,p in parts.items() if p['area']<400})
json.dump(res,open(OUT,'w'),separators=(',',':'))
import os;print(os.path.getsize(OUT)//1024,'KB')
