import json,sys,numpy as np,cv2
CAL=sys.argv[1].rstrip('/')+'/' if len(sys.argv)>1 else 'calib/'   # folder with reference_clean.png, fig_boxes.json, ref_mask_N.png
VIEWS=['front','front_left_45','left_profile','back_left_45','back','back_right_45','right_profile','front_right_45']
PAL={'skin':(254,188,143),'outline':(76,40,26),'shade':(195,125,96)}
HEX={k:'#%02X%02X%02X'%v for k,v in PAL.items()}
S=4
def paths(mask,min_area=5,eps=1.2):
    big=cv2.resize(mask.astype(np.float32),None,fx=S,fy=S,interpolation=cv2.INTER_CUBIC)
    big=cv2.GaussianBlur(big,(0,0),S*0.45)
    b=(big>0.5).astype(np.uint8)
    cs,h=cv2.findContours(b,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_NONE)
    d=[]
    for c in cs:
        if abs(cv2.contourArea(c))/(S*S)<min_area: continue
        a=cv2.approxPolyDP(c,eps,True)[:,0,:]/S
        if len(a)<3: continue
        d.append('M'+' L'.join('%.1f %.1f'%(x,y) for x,y in a)+'Z')
    return ' '.join(d)
im=cv2.imread(CAL+'reference_clean.png');fb=json.load(open(CAL+'fig_boxes.json'))
out={}
for i,v in enumerate(VIEWS):
    x0,y0,x1,y1=fb[i];c=im[y0:y1,x0:x1].astype(np.float32)[...,::-1]
    m=cv2.imread(CAL+'ref_mask_%d.png'%i,0)>127
    keys=list(PAL);cen=np.array([PAL[k] for k in keys],np.float32)
    d=((c[:,:,None,:]-cen[None,None])**2).sum(-1);cls=d.argmin(-1)
    sil=m.copy()
    layers={k:(cls==j)&m for j,k in enumerate(keys)}
    h,w=m.shape
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
    inner=cv2.erode(sil.astype(np.uint8),np.ones((3,3),np.uint8))>0     # keep a 1px rim so the picture edge is always outline colour
    svg+=f'<path fill="{HEX["outline"]}" d="{paths(cv2.dilate(sil.astype(np.uint8),np.ones((3,3),np.uint8))>0)}"/>'
    svg+=f'<path fill="{HEX["skin"]}" d="{paths(((layers["skin"]|layers["shade"])&inner))}"/>'
    svg+=f'<path fill="{HEX["shade"]}" d="{paths(layers["shade"]&inner)}"/>'
    svg+=f'<path fill="{HEX["outline"]}" fill-rule="evenodd" d="{paths(layers["outline"],min_area=3)}"/></svg>'
    open(f'{sys.argv[2] if len(sys.argv)>2 else "trace"}/{v}.svg','w').write(svg);out[v]=len(svg)
print(out)
